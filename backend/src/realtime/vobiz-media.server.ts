import { ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { completeProviderCallTask, failProviderCallTask, markCallTaskConnected } from '../services/call-task.service.js';
import { runBolnaSession } from '../services/bolna-client.service.js';
import { hangupVobizCall } from '../services/vobiz.service.js';
import type { CallTaskDocument, CallTaskRequest, ConversationMessage } from '../types/call-task.js';
import type { ContactDocument } from '../types/contact.js';
import { muLawToPcm, muLawToWav, wavToMuLaw } from './audio.js';

type MediaDependencies = { callTasks: Collection<CallTaskDocument>; contacts: Collection<ContactDocument> };
type SessionRequest = CallTaskRequest & { contact: { name: string; relation: string; relationDescription: string; closeness: string } };
type LoadedSessionRequest = { request: SessionRequest; callId: string };
type SessionResponse = { audioBase64: string; transcript: string; answer: string; intentComplete: boolean };

// Serves Vobiz media events and keeps one conversation history per active task.
export function createVobizMediaServer(server: Server, { callTasks, contacts }: MediaDependencies) {
  const sockets = new WebSocketServer({ noServer: true });
  const conversations = new Map<string, ConversationMessage[]>();
  server.on('upgrade', (request, socket, head) => {
    const match = request.url?.match(/^\/webhooks\/vobiz\/media\/([^/?]+)/);
    if (!match) {
      console.warn(`[vobiz] rejected websocket path=${request.url}`);
      return socket.destroy();
    }
    console.log(`[vobiz] websocket upgrade task=${match[1]}`);
    sockets.handleUpgrade(request, socket, head, (client) => handleSocket(client, match[1], callTasks, contacts, conversations));
  });
}

function handleSocket(client: WebSocket, taskId: string, callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>, conversations: Map<string, ConversationMessage[]>) {
  let frames: Buffer[] = [];
  let streamId = '';
  let silenceTimer: NodeJS.Timeout | undefined;
  let playing = false;
  let processing = false;
  let hasCallerSpeech = false;
  let streamEnded = false;
  let finalized = false;
  let ending = false;
  let started = false;
  let checkpointWaiter: { name: string; resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;
  const history = conversations.get(taskId) ?? [];
  conversations.set(taskId, history);
  const waitForPlayback = (name: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      checkpointWaiter = undefined;
      reject(new Error('Vobiz did not confirm final audio playback'));
    }, 30_000);
    checkpointWaiter = {
      name,
      timer,
      resolve: () => { clearTimeout(timer); checkpointWaiter = undefined; resolve(); },
      reject: (error) => { clearTimeout(timer); checkpointWaiter = undefined; reject(error); },
    };
  });
  const scheduleTurn = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (streamEnded || finalized || !hasCallerSpeech || !frames.length) return;
    silenceTimer = setTimeout(() => {
      silenceTimer = undefined;
      if (streamEnded || finalized) return;
      if (processing) {
        scheduleTurn();
        return;
      }
      const turn = frames;
      frames = [];
      hasCallerSpeech = false;
      processing = true;
      console.log(`[vobiz] turn detected task=${taskId} frames=${turn.length}`);
      void finishTurn(client, taskId, streamId, turn, callTasks, contacts, history, false, () => { playing = true; }, waitForPlayback, () => {
        if (hasCallerSpeech || frames.length) return false;
        ending = true;
        return true;
      })
        .finally(() => {
          processing = false;
          if (streamEnded) void endStream();
          else if (hasCallerSpeech) scheduleTurn();
        });
    }, 1_200);
  };
  const endStream = async () => {
    if (finalized) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = undefined;
    if (processing) return;
    if (hasCallerSpeech && frames.length) {
      const turn = frames;
      frames = [];
      hasCallerSpeech = false;
      processing = true;
      await finishTurn(client, taskId, streamId, turn, callTasks, contacts, history, true, () => { playing = true; }, waitForPlayback, () => {
        if (hasCallerSpeech || frames.length) return false;
        ending = true;
        return true;
      });
      processing = false;
    } else {
      await persistConversation(callTasks, taskId, history);
    }
    finalized = true;
    conversations.delete(taskId);
  };
  client.on('message', async (raw) => {
    let event: { event?: string; streamId?: string; callId?: string; streamSid?: string; start?: { streamId?: string; streamSid?: string; callId?: string }; media?: { payload?: string; track?: string }; name?: string };
    try {
      const parsed: unknown = JSON.parse(String(raw));
      if (!parsed || typeof parsed !== 'object') return;
      event = parsed as typeof event;
    } catch {
      console.warn(`[vobiz] ignored malformed websocket message task=${taskId}`);
      return;
    }
    if (typeof event.event !== 'string') return;
    console.log(`[vobiz] event=${event.event} task=${taskId}`);
    if (event.event === 'start') {
      if (started) return;
      started = true;
      streamId = event.start?.streamId ?? event.streamId ?? event.start?.streamSid ?? event.streamSid ?? '';
      const loaded = await loadSessionRequest(taskId, callTasks, contacts);
      await markCallTaskConnected(callTasks, taskId);
      processing = true;
      try {
        const session = await runBolnaSession({ ...loaded.request, isFirstCall: true }, undefined, undefined, history) as SessionResponse;
        history.push({ role: 'assistant', content: session.answer });
        await playSessionAudio(client, streamId, session, () => { playing = true; });
      } catch (error) {
        console.error(`[vobiz] greeting failed task=${taskId} error=${error instanceof Error ? error.message : String(error)}`);
        await failProviderCallTask(callTasks, taskId, error instanceof Error ? error.message : String(error));
      } finally {
        processing = false;
        if (streamEnded) void endStream();
        else if (hasCallerSpeech) scheduleTurn();
      }
    }
    if (event.event === 'media' && !ending && event.media?.payload && (!event.media.track || event.media.track === 'inbound')) {
      const frame = Buffer.from(event.media.payload, 'base64');
      const speech = isSpeech(frame);
      if (speech) {
        if (playing) {
          client.send(JSON.stringify({ event: 'clearAudio', streamId }));
          playing = false;
        }
        hasCallerSpeech = true;
        frames.push(frame);
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = undefined;
      } else if (hasCallerSpeech && !playing) {
        frames.push(frame);
        if (!silenceTimer) scheduleTurn();
      }
    }
    if (event.event === 'playedStream') {
      playing = false;
      if (checkpointWaiter?.name === event.name) checkpointWaiter.resolve();
    }
    if (event.event === 'clearedAudio') {
      playing = false;
      checkpointWaiter?.reject(new Error('Vobiz cleared final audio before playback completed'));
    }
    if (event.event === 'stop') {
      streamEnded = true;
      await endStream();
    }
  });
  client.on('close', () => {
    streamEnded = true;
    checkpointWaiter?.reject(new Error('Vobiz media stream closed before final audio playback'));
    void endStream();
  });
}

function isSpeech(frame: Buffer) {
  let total = 0;
  for (const sample of frame) total += Math.abs(muLawToPcm(sample));
  return total / Math.max(frame.length, 1) > 700;
}

async function loadSessionRequest(taskId: string, callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>): Promise<LoadedSessionRequest> {
  const task = await callTasks.findOne({ _id: new ObjectId(taskId) });
  if (!task) throw new Error('Call task not found');
  const callId = task.provider?.vobizCallId;
  if (!callId) throw new Error('Vobiz call identifier is missing');
  const contact = await contacts.findOne({ _id: task.contactId });
  if (!contact) throw new Error('Contact not found');
  return {
    callId,
    request: {
      ...task.request,
      greeting: task.request.greeting ?? `Hi, this is Aryan's calling assistant.`,
      contact: { name: contact.name, relation: contact.relation.relationship, relationDescription: task.request.relation.description, closeness: contact.relation.closeness },
    },
  };
}

async function playSessionAudio(client: WebSocket, streamId: string, session: SessionResponse, onAudioStart: () => void, waitForPlayback?: (name: string) => Promise<void>) {
  const audio = wavToMuLaw(Buffer.from(session.audioBase64, 'base64'));
  if (client.readyState !== WebSocket.OPEN) {
    if (waitForPlayback) throw new Error('Vobiz media stream closed before final audio playback');
    return;
  }
  onAudioStart();
  for (let offset = 0; offset < audio.length; offset += 160) {
    if (client.readyState !== WebSocket.OPEN) {
      if (waitForPlayback) throw new Error('Vobiz media stream closed before final audio playback');
      return;
    }
    const payload = audio.subarray(offset, offset + 160);
    client.send(JSON.stringify({ event: 'playAudio', streamSid: streamId, media: { contentType: 'audio/x-mulaw', sampleRate: 8000, payload: payload.toString('base64') } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (client.readyState === WebSocket.OPEN) {
    const name = `response-${Date.now()}`;
    const playback = waitForPlayback?.(name);
    client.send(JSON.stringify({ event: 'checkpoint', streamId, name }));
    if (playback) await playback;
  } else if (waitForPlayback) {
    throw new Error('Vobiz media stream closed before final audio playback');
  }
}

async function persistConversation(callTasks: Collection<CallTaskDocument>, taskId: string, history: ConversationMessage[]) {
  const transcript = history.map((message) => ({ speaker: message.role === 'user' ? 'contact' as const : 'agent' as const, text: message.content, startedAtMs: 0, endedAtMs: 0 }));
  await completeProviderCallTask(callTasks, taskId, { transcript, endedAt: new Date() });
}

async function finishTurn(client: WebSocket, taskId: string, streamId: string, frames: Buffer[], callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>, history: ConversationMessage[], terminal: boolean, onAudioStart: () => void, waitForPlayback: (name: string) => Promise<void>, markEnding: () => boolean) {
  let shouldFailTask = terminal;
  try {
    console.log(`[vobiz] turn processing task=${taskId} terminal=${terminal} frames=${frames.length}`);
    const loaded = await loadSessionRequest(taskId, callTasks, contacts);
    const session = await runBolnaSession({ ...loaded.request, isFirstCall: false }, muLawToWav(frames).toString('base64'), 'audio/wav', history) as SessionResponse;
    console.log(`[vobiz] turn response task=${taskId} transcriptChars=${session.transcript.length} answerChars=${session.answer.length}`);
    if (session.transcript.trim()) history.push({ role: 'user', content: session.transcript });
    history.push({ role: 'assistant', content: session.answer });
    const intentComplete = session.intentComplete && Boolean(session.transcript.trim());
    if (intentComplete && !terminal && markEnding()) {
      shouldFailTask = true;
      await playSessionAudio(client, streamId, session, onAudioStart, waitForPlayback);
      await hangupVobizCall(loaded.callId);
      await completeProviderCallTask(callTasks, taskId, {
        confirmedAnswer: session.answer,
        intentComplete: true,
        transcript: history.map((message) => ({ speaker: message.role === 'user' ? 'contact' : 'agent', text: message.content, startedAtMs: 0, endedAtMs: 0 })),
        endedAt: new Date(),
      });
    } else if (!terminal) {
      await playSessionAudio(client, streamId, session, onAudioStart);
    }
    if (terminal) await completeProviderCallTask(callTasks, taskId, {
      confirmedAnswer: session.answer,
      intentComplete: session.intentComplete,
      transcript: history.map((message) => ({ speaker: message.role === 'user' ? 'contact' : 'agent', text: message.content, startedAtMs: 0, endedAtMs: 0 })),
      endedAt: new Date(),
    });
  } catch (error) {
    console.error(`[vobiz] turn failed task=${taskId} error=${error instanceof Error ? error.message : String(error)}`);
    if (shouldFailTask) await failProviderCallTask(callTasks, taskId, error instanceof Error ? error.message : String(error));
  }
}

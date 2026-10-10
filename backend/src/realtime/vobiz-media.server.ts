import { ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { completeProviderCallTask, failProviderCallTask, markCallTaskConnected } from '../services/call-task.service.js';
import { runBolnaSession } from '../services/bolna-client.service.js';
import type { CallTaskDocument, CallTaskRequest, ConversationMessage } from '../types/call-task.js';
import type { ContactDocument } from '../types/contact.js';
import { muLawToPcm, muLawToWav, wavToMuLaw } from './audio.js';

type MediaDependencies = { callTasks: Collection<CallTaskDocument>; contacts: Collection<ContactDocument> };
type SessionRequest = CallTaskRequest & { contact: { name: string; relation: string; relationDescription: string; closeness: string } };
type SessionResponse = { audioBase64: string; transcript: string; answer: string };

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
  const history = conversations.get(taskId) ?? [];
  conversations.set(taskId, history);
  client.on('message', async (raw) => {
    const event = JSON.parse(String(raw)) as { event: string; start?: { streamId?: string; streamSid?: string }; media?: { payload: string; track?: string }; name?: string };
    console.log(`[vobiz] event=${event.event} task=${taskId}`);
    if (event.event === 'start') {
      streamId = event.start?.streamId ?? event.start?.streamSid ?? '';
      await markCallTaskConnected(callTasks, taskId);
      const request = await loadSessionRequest(taskId, callTasks, contacts);
      const session = await runBolnaSession({ ...request, isFirstCall: true }, undefined, undefined, history) as SessionResponse;
      history.push({ role: 'assistant', content: session.answer });
      await playSessionAudio(client, streamId, session, () => { playing = true; });
    }
    if (event.event === 'media' && event.media?.payload && (!event.media.track || event.media.track === 'inbound')) {
      const frame = Buffer.from(event.media.payload, 'base64');
      const speech = isSpeech(frame);
      if (playing && !speech) return;
      frames.push(frame);
      if (speech) {
        if (playing) {
          client.send(JSON.stringify({ event: 'clearAudio', streamId }));
          playing = false;
        }
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = undefined;
      } else if (!silenceTimer && frames.length > 3) {
        silenceTimer = setTimeout(() => {
          silenceTimer = undefined;
          if (!processing) {
            const turn = frames;
            frames = [];
            processing = true;
            console.log(`[vobiz] turn detected task=${taskId} frames=${turn.length}`);
            void finishTurn(client, taskId, streamId, turn, callTasks, contacts, history, false, () => { playing = true; }).finally(() => { processing = false; });
          }
        }, 1_200);
      }
    }
    if (event.event === 'playedStream' || event.event === 'clearedAudio') playing = false;
    if (event.event === 'stop') {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (frames.length && !processing) {
        processing = true;
        await finishTurn(client, taskId, streamId, frames, callTasks, contacts, history, true, () => { playing = true; });
        processing = false;
      }
    }
  });
  client.on('close', () => { if (silenceTimer) clearTimeout(silenceTimer); conversations.delete(taskId); });
}

function isSpeech(frame: Buffer) {
  let total = 0;
  for (const sample of frame) total += Math.abs(muLawToPcm(sample));
  return total / Math.max(frame.length, 1) > 700;
}

async function loadSessionRequest(taskId: string, callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>): Promise<SessionRequest> {
  const task = await callTasks.findOne({ _id: new ObjectId(taskId) });
  if (!task) throw new Error('Call task not found');
  const contact = await contacts.findOne({ _id: task.contactId });
  if (!contact) throw new Error('Contact not found');
  return {
    ...task.request,
    greeting: task.request.greeting ?? `Hi, this is Aryan's calling assistant.`,
    contact: { name: contact.name, relation: contact.relation.relationship, relationDescription: task.request.relation.description, closeness: contact.relation.closeness },
  };
}

async function playSessionAudio(client: WebSocket, streamId: string, session: SessionResponse, onAudioStart: () => void) {
  const audio = wavToMuLaw(Buffer.from(session.audioBase64, 'base64'));
  onAudioStart();
  for (let offset = 0; offset < audio.length; offset += 160) {
    const payload = audio.subarray(offset, offset + 160);
    client.send(JSON.stringify({ event: 'playAudio', streamSid: streamId, media: { contentType: 'audio/x-mulaw', sampleRate: 8000, payload: payload.toString('base64') } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  client.send(JSON.stringify({ event: 'checkpoint', streamId, name: `response-${Date.now()}` }));
}

async function finishTurn(client: WebSocket, taskId: string, streamId: string, frames: Buffer[], callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>, history: ConversationMessage[], terminal: boolean, onAudioStart: () => void) {
  try {
    console.log(`[vobiz] turn processing task=${taskId} terminal=${terminal} frames=${frames.length}`);
    const request = await loadSessionRequest(taskId, callTasks, contacts);
    const session = await runBolnaSession({ ...request, isFirstCall: false }, muLawToWav(frames).toString('base64'), 'audio/wav', history) as SessionResponse;
    console.log(`[vobiz] turn response task=${taskId} transcriptChars=${session.transcript.length} answerChars=${session.answer.length}`);
    history.push({ role: 'user', content: session.transcript }, { role: 'assistant', content: session.answer });
    await playSessionAudio(client, streamId, session, onAudioStart);
    if (terminal) await completeProviderCallTask(callTasks, taskId, { confirmedAnswer: session.answer, transcript: history.map((message) => ({ speaker: message.role === 'user' ? 'contact' : 'agent', text: message.content, startedAtMs: 0, endedAtMs: 0 })), endedAt: new Date() });
  } catch (error) {
    console.error(`[vobiz] turn failed task=${taskId} error=${error instanceof Error ? error.message : String(error)}`);
    if (terminal) await failProviderCallTask(callTasks, taskId, error instanceof Error ? error.message : String(error));
  }
}

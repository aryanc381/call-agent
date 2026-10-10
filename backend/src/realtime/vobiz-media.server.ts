import { ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { completeProviderCallTask, failProviderCallTask, markCallTaskConnected } from '../services/call-task.service.js';
import { runBolnaSession } from '../services/bolna-client.service.js';
import type { CallTaskDocument } from '../types/call-task.js';
import type { ContactDocument } from '../types/contact.js';
import { muLawToPcm, muLawToWav, wavToMuLaw } from './audio.js';

type MediaDependencies = { callTasks: Collection<CallTaskDocument>; contacts: Collection<ContactDocument> };

// Serves Vobiz media events and bridges one call turn through the Python session contract.
export function createVobizMediaServer(server: Server, { callTasks, contacts }: MediaDependencies) {
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const match = request.url?.match(/^\/webhooks\/vobiz\/media\/([^/?]+)/);
    if (!match) {
      console.warn(`[vobiz] rejected websocket path=${request.url}`);
      return socket.destroy();
    }
    console.log(`[vobiz] websocket upgrade task=${match[1]}`);
    sockets.handleUpgrade(request, socket, head, (client) => handleSocket(client, match[1], callTasks, contacts));
  });
}

function handleSocket(client: WebSocket, taskId: string, callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>) {
  let frames: Buffer[] = [];
  let streamId = '';
  let silenceTimer: NodeJS.Timeout | undefined;
  let playing = false;
  let processing = false;
  client.on('message', async (raw) => {
    const event = JSON.parse(String(raw)) as { event: string; start?: { streamId?: string; streamSid?: string }; media?: { payload: string; track?: string }; name?: string };
    console.log(`[vobiz] event=${event.event} task=${taskId}`);
    if (event.event === 'start') {
      streamId = event.start?.streamId ?? event.start?.streamSid ?? '';
      await markCallTaskConnected(callTasks, taskId);
    }
    if (event.event === 'media' && event.media?.payload && (!event.media.track || event.media.track === 'inbound')) {
      const frame = Buffer.from(event.media.payload, 'base64');
      frames.push(frame);
      if (isSpeech(frame)) {
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
            void finishTurn(client, taskId, streamId, turn, callTasks, contacts, false, () => { playing = true; }).finally(() => { processing = false; });
          }
        }, 1_200);
      }
    }
    if (event.event === 'playedStream' || event.event === 'clearedAudio') playing = false;
    if (event.event === 'stop') {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (frames.length && !processing) {
        processing = true;
        await finishTurn(client, taskId, streamId, frames, callTasks, contacts, true, () => { playing = true; });
        processing = false;
      }
    }
  });

  client.on('close', () => { if (silenceTimer) clearTimeout(silenceTimer); });
}

function isSpeech(frame: Buffer) {
  let total = 0;
  for (const sample of frame) total += Math.abs(muLawToPcm(sample));
  return total / Math.max(frame.length, 1) > 700;
}

async function finishTurn(client: WebSocket, taskId: string, streamId: string, frames: Buffer[], callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>, terminal: boolean, onAudioStart: () => void) {
  try {
    console.log(`[vobiz] turn processing task=${taskId} terminal=${terminal} frames=${frames.length}`);
    const task = await callTasks.findOne({ _id: new ObjectId(taskId) });
    if (!task) throw new Error('Call task not found');
    const contact = await contacts.findOne({ _id: task.contactId });
    if (!contact) throw new Error('Contact not found');
    const session = await runBolnaSession({ ...task.request, contact: { name: contact.name, relation: contact.relation.relationship, relationDescription: task.request.relation.description, closeness: contact.relation.closeness } }, muLawToWav(frames).toString('base64'), 'audio/wav');
    console.log(`[vobiz] turn response task=${taskId} transcriptChars=${session.transcript.length} answerChars=${session.answer.length}`);
    const audio = wavToMuLaw(Buffer.from(session.audioBase64, 'base64'));
    onAudioStart();
    for (let offset = 0; offset < audio.length; offset += 160) {
      const payload = audio.subarray(offset, offset + 160);
      client.send(JSON.stringify({ event: 'playAudio', streamSid: streamId, media: { contentType: 'audio/x-mulaw', sampleRate: 8000, payload: payload.toString('base64') } }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    client.send(JSON.stringify({ event: 'checkpoint', streamId, name: `response-${Date.now()}` }));
    if (terminal) await completeProviderCallTask(callTasks, taskId, { confirmedAnswer: session.answer, transcript: [{ speaker: 'contact', text: session.transcript, startedAtMs: 0, endedAtMs: 0 }], endedAt: new Date() });
  } catch (error) {
    console.error(`[vobiz] turn failed task=${taskId} error=${error instanceof Error ? error.message : String(error)}`);
    if (terminal) await failProviderCallTask(callTasks, taskId, error instanceof Error ? error.message : String(error));
  }
}

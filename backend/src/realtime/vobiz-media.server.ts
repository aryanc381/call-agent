import { ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { completeProviderCallTask, failProviderCallTask, markCallTaskConnected } from '../services/call-task.service.js';
import { runBolnaSession } from '../services/bolna-client.service.js';
import type { CallTaskDocument } from '../types/call-task.js';
import type { ContactDocument } from '../types/contact.js';
import { muLawToWav, wavToMuLaw } from './audio.js';

type MediaDependencies = { callTasks: Collection<CallTaskDocument>; contacts: Collection<ContactDocument> };

// Serves Vobiz media events and bridges one call turn through the Python session contract.
export function createVobizMediaServer(server: Server, { callTasks, contacts }: MediaDependencies) {
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const match = request.url?.match(/^\/webhooks\/vobiz\/media\/([^/?]+)/);
    if (!match) return socket.destroy();
    sockets.handleUpgrade(request, socket, head, (client) => handleSocket(client, match[1], callTasks, contacts));
  });
}

function handleSocket(client: WebSocket, taskId: string, callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>) {
  const frames: Buffer[] = [];
  let streamId = '';
  client.on('message', async (raw) => {
    const event = JSON.parse(String(raw)) as { event: string; start?: { streamSid?: string }; media?: { payload: string } };
    if (event.event === 'start') {
      streamId = event.start?.streamSid ?? '';
      await markCallTaskConnected(callTasks, taskId);
    }
    if (event.event === 'media' && event.media?.payload) frames.push(Buffer.from(event.media.payload, 'base64'));
    if (event.event === 'stop') await finishTurn(client, taskId, streamId, frames, callTasks, contacts);
  });
}

async function finishTurn(client: WebSocket, taskId: string, streamId: string, frames: Buffer[], callTasks: Collection<CallTaskDocument>, contacts: Collection<ContactDocument>) {
  try {
    const task = await callTasks.findOne({ _id: new ObjectId(taskId) });
    if (!task) throw new Error('Call task not found');
    const contact = await contacts.findOne({ _id: task.contactId });
    if (!contact) throw new Error('Contact not found');
    const session = await runBolnaSession({ ...task.request, contact: { name: contact.name, relation: contact.relation.relationship, relationDescription: task.request.relation.description, closeness: contact.relation.closeness } }, muLawToWav(frames).toString('base64'), 'audio/wav');
    client.send(JSON.stringify({ event: 'playAudio', streamSid: streamId, media: { payload: wavToMuLaw(Buffer.from(session.audioBase64, 'base64')).toString('base64') } }));
    await completeProviderCallTask(callTasks, taskId, { confirmedAnswer: session.answer, transcript: [{ speaker: 'contact', text: session.transcript, startedAtMs: 0, endedAtMs: 0 }], endedAt: new Date() });
  } catch (error) {
    await failProviderCallTask(callTasks, taskId, error instanceof Error ? error.message : String(error));
    client.close();
  }
}

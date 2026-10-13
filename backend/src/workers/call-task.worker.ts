import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Worker } from 'bullmq';
import type { Collection } from 'mongodb';
import type { Redis } from 'ioredis';

import { claimCallTask, failProviderCallTask, markCallTaskDialing } from '../services/call-task.service.js';
import { createVobizCall } from '../services/vobiz.service.js';
import type { CallTaskDocument, CallTaskJob } from '../types/call-task.js';
import type { ContactDocument } from '../types/contact.js';

// Creates the worker that takes queued calls and asks Vobiz to dial them.
export function createCallTaskWorker(callTasks: Collection<CallTaskDocument>, connection: Redis, contacts: Collection<ContactDocument>, publicBaseUrl: string, workerId = randomUUID()) {
  const worker = new Worker<CallTaskJob>('call-tasks', async (job) => {
    const claimToken = randomUUID();
    const task = await claimCallTask(callTasks, job.data.taskId, workerId, claimToken, 5 * 60 * 1_000);
    if (!task) return;
    try {
      const contact = await contacts.findOne({ _id: new ObjectId(task.contactId) });
      if (!contact) throw new Error('Contact not found');
      const callId = await createVobizCall({ to: contact.phoneNumber, answerUrl: `${publicBaseUrl}/webhooks/vobiz/answer/${task.id}`, hangupUrl: `${publicBaseUrl}/webhooks/vobiz/hangup/${task.id}` });
      await markCallTaskDialing(callTasks, task.id, claimToken, callId);
    } catch (error) {
      await failProviderCallTask(callTasks, task.id, error instanceof Error ? error.message : 'Could not start call');
    }
  }, { connection });
  worker.on('error', () => undefined);
  return worker;
}

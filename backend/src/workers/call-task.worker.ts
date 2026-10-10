import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import {
  claimCallTask,
  failCallTask,
} from '../services/call-task.service.js';
import type {
  CallTask,
  CallTaskDocument,
  CallTaskJob,
} from '../types/call-task.js';
import type { Collection } from 'mongodb';
import type { ContactDocument } from '../types/contact.js';
import { createVobizCall } from '../services/vobiz.service.js';
import { markCallTaskDialing } from '../services/call-task.service.js';

const leaseMilliseconds = 5 * 60 * 1_000;

// Creates the worker that claims queued tasks and starts documented Vobiz calls.
export function createCallTaskWorker(
  callTasks: Collection<CallTaskDocument>,
  connection: Redis,
  contacts: Collection<ContactDocument>,
  publicBaseUrl: string,
  workerId = randomUUID(),
) {
  const worker = new Worker<CallTaskJob>(
    'call-tasks',
    async (job) => {
      const claimToken = randomUUID();
      const task = await claimCallTask(
        callTasks,
        job.data.taskId,
        workerId,
        claimToken,
        leaseMilliseconds,
      );

      if (!task) {
        return;
      }

      try {
        const contact = await contacts.findOne({ _id: new ObjectId(task.contactId) });
        if (!contact) throw new Error('Contact not found for call task');
        const callId = await createVobizCall({
          to: contact.phoneNumber,
          answerUrl: `${publicBaseUrl}/webhooks/vobiz/answer/${task.id}`,
          hangupUrl: `${publicBaseUrl}/webhooks/vobiz/hangup/${task.id}`,
        });
        await markCallTaskDialing(callTasks, task.id, claimToken, callId);
      } catch (error) {
        await failCallTask(
          callTasks,
          task.id,
          claimToken,
          'Vobiz call initiation failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    { connection },
  );

  // Prevents worker connection errors from becoming uncaught events.
  worker.on('error', () => undefined);

  return worker;
}

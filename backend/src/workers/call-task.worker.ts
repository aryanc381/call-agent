import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import {
  claimCallTask,
  completeCallTask,
  failCallTask,
} from '../services/call-task.service.js';
import type {
  CallTask,
  CallTaskDocument,
  CallTaskJob,
} from '../types/call-task.js';
import type { Collection } from 'mongodb';

const leaseMilliseconds = 5 * 60 * 1_000;

// Creates the worker that claims and simulates queued call tasks.
export function createCallTaskWorker(
  callTasks: Collection<CallTaskDocument>,
  connection: Redis,
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
        await completeCallTask(
          callTasks,
          task.id,
          claimToken,
          simulateCallExecution(task),
        );
      } catch (error) {
        await failCallTask(
          callTasks,
          task.id,
          claimToken,
          'Simulated call execution failed',
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

// Returns a deterministic result for the Phase 1.5 simulated executor.
function simulateCallExecution(task: CallTask) {
  if (task.request.question === '__simulate_failure__') {
    throw new Error('Requested simulated failure');
  }

  return {
    confirmedAnswer: 'Simulated answer',
    transcript: [
      {
        speaker: 'agent' as const,
        text: task.request.question,
        startedAtMs: 0,
        endedAtMs: 500,
      },
      {
        speaker: 'contact' as const,
        text: 'Simulated response',
        startedAtMs: 500,
        endedAtMs: 1_000,
      },
    ],
    durationSeconds: 1,
    endedAt: new Date(),
  };
}

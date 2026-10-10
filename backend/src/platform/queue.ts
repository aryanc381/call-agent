import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// Creates the queue that will hold call tasks in the next implementation part.
export function createCallTaskQueue(connection: Redis) {
  const queue = new Queue('call-tasks', { connection });

  // Prevents offline dependency errors from becoming uncaught queue events.
  queue.on('error', () => undefined);

  return queue;
}

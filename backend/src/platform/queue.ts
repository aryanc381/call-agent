import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// Creates the queue that holds requested calls until a worker can dial them.
export function createCallTaskQueue(connection: Redis) {
  const queue = new Queue('call-tasks', { connection });
  queue.on('error', () => undefined);
  return queue;
}

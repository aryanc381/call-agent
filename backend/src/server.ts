import { createApp } from './app.js';
import { createApiKeyAuth } from './middleware/auth.middleware.js';
import {
  ensureContactIndexes,
  getContactsCollection,
} from './models/contact.model.js';
import {
  ensureCallTaskIndexes,
  getCallTasksCollection,
} from './models/call-task.model.js';
import { createMongoClient } from './platform/mongo.js';
import { createCallTaskQueue } from './platform/queue.js';
import { createRedisClient } from './platform/redis.js';
import { isReady } from './platform/readiness.js';
import { env } from './utils/env.js';
import { createCallTaskWorker } from './workers/call-task.worker.js';

const mongo = createMongoClient(env.mongodbUri);
const redis = createRedisClient(env.redisUrl);
const callTaskQueue = createCallTaskQueue(redis);
const contacts = getContactsCollection(mongo.db());
const callTasks = getCallTasksCollection(mongo.db());
const app = createApp({
  apiKeyAuth: createApiKeyAuth(env.personalApiKey),
  contacts,
  callTasks,
  queue: callTaskQueue,
  isReady: () => isReady(mongo, redis),
  publicBaseUrl: env.publicBaseUrl,
});
let server: ReturnType<typeof app.listen> | undefined;
let callTaskWorker: ReturnType<typeof createCallTaskWorker> | undefined;

// Connects MongoDB and creates required indexes before accepting HTTP requests.
async function start() {
  await mongo.connect();
  await connectRedis();
  await ensureContactIndexes(contacts);
  await ensureCallTaskIndexes(callTasks);
  callTaskWorker = createCallTaskWorker(callTasks, redis);

  server = app.listen(env.port, () => {
    console.log(`Call agent backend listening on port ${env.port}`);
  });
}

// Waits for Redis to finish connecting before accepting task requests.
async function connectRedis() {
  if (redis.status === 'wait') {
    await redis.connect();
    return;
  }

  if (redis.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
    });
  }
}

// Stops startup when a required dependency cannot be initialized.
function failStart(error: unknown) {
  console.error('Could not start backend:', error);
  process.exit(1);
}

void start().catch(failStart);

// Closes application resources before the process exits.
async function shutdown(signal: NodeJS.Signals) {
  console.log(`Received ${signal}; shutting down`);
  await callTaskWorker?.close().catch(() => undefined);
  await callTaskQueue.close().catch(() => undefined);
  await redis.quit().catch(() => redis.disconnect());
  await mongo.close();
  server?.close(() => process.exit(0));
}

// Starts graceful shutdown when the process receives a termination signal.
function stopOnSignal(signal: NodeJS.Signals) {
  return () => void shutdown(signal);
}

process.once('SIGTERM', stopOnSignal('SIGTERM'));
process.once('SIGINT', stopOnSignal('SIGINT'));

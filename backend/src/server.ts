import { createApp } from './app.js';
import { createApiKeyAuth } from './middleware/auth.middleware.js';
import { ensureContactIndexes, getContactsCollection } from './models/contact.model.js';
import { ensureCallTaskIndexes, getCallTasksCollection } from './models/call-task.model.js';
import { createMongoClient } from './platform/mongo.js';
import { createCallTaskQueue } from './platform/queue.js';
import { createRedisClient } from './platform/redis.js';
import { isReady } from './platform/readiness.js';
import { createVobizMediaServer } from './realtime/vobiz-media.server.js';
import { env } from './utils/env.js';
import { createCallTaskWorker } from './workers/call-task.worker.js';

const mongo = createMongoClient(env.mongodbUri);
const redis = createRedisClient(env.redisUrl);
const queue = createCallTaskQueue(redis);
const contacts = getContactsCollection(mongo.db());
const callTasks = getCallTasksCollection(mongo.db());
const app = createApp({ apiKeyAuth: createApiKeyAuth(env.personalApiKey), contacts, callTasks, queue, isReady: () => isReady(mongo, redis), personality: env.agentPersonality, publicBaseUrl: env.publicBaseUrl ?? '' });

// Connects storage, creates indexes, starts the worker, and serves HTTP/media traffic.
async function start() {
  if (!env.publicBaseUrl) throw new Error('PUBLIC_BASE_URL is required');
  await mongo.connect();
  await connectRedis();
  await ensureContactIndexes(contacts);
  await ensureCallTaskIndexes(callTasks);
  createCallTaskWorker(callTasks, redis, contacts, env.publicBaseUrl);
  const server = app.listen(env.port, () => console.log(`Call agent backend listening on port ${env.port}`));
  createVobizMediaServer(server, { callTasks, contacts });
}

// Waits for the queue's shared Redis connection without connecting it twice.
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
function failStart(error: unknown) { console.error('Could not start backend:', error); process.exit(1); }
void start().catch(failStart);

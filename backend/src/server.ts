import { createApp } from './app.js';
import { createApiKeyAuth } from './middleware/auth.middleware.js';
import {
  ensureContactIndexes,
  getContactsCollection,
} from './models/contact.model.js';
import { createMongoClient } from './platform/mongo.js';
import { createCallTaskQueue } from './platform/queue.js';
import { createRedisClient } from './platform/redis.js';
import { isReady } from './platform/readiness.js';
import { env } from './utils/env.js';

const mongo = createMongoClient(env.mongodbUri);
const redis = createRedisClient(env.redisUrl);
const callTaskQueue = createCallTaskQueue(redis);
const contacts = getContactsCollection(mongo.db());
const app = createApp({
  apiKeyAuth: createApiKeyAuth(env.personalApiKey),
  contacts,
  isReady: () => isReady(mongo, redis),
});
let server: ReturnType<typeof app.listen> | undefined;

// Connects MongoDB and creates required indexes before accepting HTTP requests.
async function start() {
  await mongo.connect();
  await ensureContactIndexes(contacts);

  server = app.listen(env.port, () => {
    console.log(`Call agent backend listening on port ${env.port}`);
  });
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

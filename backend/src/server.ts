import { createApp } from './app.js';
import { createApiKeyAuth } from './auth.js';
import { env } from './env.js';
import { createMongoClient } from './platform/mongo.js';
import { createCallTaskQueue } from './platform/queue.js';
import { createRedisClient } from './platform/redis.js';
import { isReady } from './platform/readiness.js';

const mongo = createMongoClient(env.mongodbUri);
const redis = createRedisClient(env.redisUrl);
const callTaskQueue = createCallTaskQueue(redis);
const app = createApp({
  apiKeyAuth: createApiKeyAuth(env.personalApiKey),
  isReady: () => isReady(mongo, redis),
});

const server = app.listen(env.port, () => {
  console.log(`Call agent backend listening on port ${env.port}`);
});

// Closes application resources before the process exits.
async function shutdown(signal: NodeJS.Signals) {
  console.log(`Received ${signal}; shutting down`);
  await callTaskQueue.close().catch(() => undefined);
  await redis.quit().catch(() => redis.disconnect());
  await mongo.close();
  server.close(() => process.exit(0));
}

// Starts graceful shutdown when the process receives a termination signal.
function stopOnSignal(signal: NodeJS.Signals) {
  return () => void shutdown(signal);
}

process.once('SIGTERM', stopOnSignal('SIGTERM'));
process.once('SIGINT', stopOnSignal('SIGINT'));

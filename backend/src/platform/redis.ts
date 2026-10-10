import { Redis } from 'ioredis';

// Creates the Redis connection shared by BullMQ and readiness checks.
export function createRedisClient(url: string) {
  const redis = new Redis(url, {
    connectTimeout: 1_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  });

  // Prevents offline dependency errors from becoming uncaught event-emitter errors.
  redis.on('error', () => undefined);

  return redis;
}

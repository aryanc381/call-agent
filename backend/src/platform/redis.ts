import { Redis } from 'ioredis';

// Creates the Redis connection used by the call queue and worker.
export function createRedisClient(url: string) {
  const redis = new Redis(url, { connectTimeout: 1_000, enableOfflineQueue: false, lazyConnect: true, maxRetriesPerRequest: null, retryStrategy: () => null });
  redis.on('error', () => undefined);
  return redis;
}

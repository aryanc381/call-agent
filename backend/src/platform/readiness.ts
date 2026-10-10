import type { MongoClient } from 'mongodb';
import type { Redis } from 'ioredis';

// Returns whether the required MongoDB and Redis dependencies are reachable.
export async function isReady(mongo: MongoClient, redis: Redis) {
  const [mongoReady, redisReady] = await Promise.all([
    isMongoReady(mongo),
    isRedisReady(redis),
  ]);

  return mongoReady && redisReady;
}

// Returns whether MongoDB responds to a ping.
async function isMongoReady(mongo: MongoClient) {
  try {
    await mongo.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

// Returns whether Redis responds to a ping and logs any connection failure.
async function isRedisReady(redis: Redis) {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    console.error('Redis readiness check failed:', error);
    return false;
  }
}

import type { MongoClient } from 'mongodb';
import type { Redis } from 'ioredis';

// Returns whether the required MongoDB and Redis dependencies are reachable.
export async function isReady(mongo: MongoClient, redis: Redis) {
  try {
    await Promise.all([mongo.db('admin').command({ ping: 1 }), redis.ping()]);
    return true;
  } catch {
    return false;
  }
}

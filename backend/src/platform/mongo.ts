import { MongoClient } from 'mongodb';

// Creates the MongoDB client used by backend services.
export function createMongoClient(uri: string) {
  return new MongoClient(uri, { serverSelectionTimeoutMS: 1_000 });
}

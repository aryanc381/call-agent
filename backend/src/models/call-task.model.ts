import type { Collection, Db } from 'mongodb';

import type { CallTaskDocument } from '../types/call-task.js';

// Returns the MongoDB collection that stores call tasks.
export function getCallTasksCollection(database: Db) {
  return database.collection<CallTaskDocument>('call_tasks');
}

// Creates the indexes required for task lookup, idempotency, and queue ordering.
export async function ensureCallTaskIndexes(
  callTasks: Collection<CallTaskDocument>,
) {
  await callTasks.createIndex({ idempotencyKey: 1 }, { unique: true });
  await callTasks.createIndex({ status: 1, createdAt: 1 });
  await callTasks.createIndex({ contactId: 1 });
}

import type { Collection, Db } from 'mongodb';

import type { ContactDocument } from '../types/contact.js';

// Returns the MongoDB collection that stores approved call contacts.
export function getContactsCollection(database: Db) {
  return database.collection<ContactDocument>('contacts');
}

// Creates the unique phone-number index required for contacts.
export async function ensureContactIndexes(
  contacts: Collection<ContactDocument>,
) {
  await contacts.createIndex({ phoneNumber: 1 }, { unique: true });
}

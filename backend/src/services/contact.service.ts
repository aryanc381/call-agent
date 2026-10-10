import { ObjectId } from 'mongodb';
import { MongoServerError } from 'mongodb';
import type { Collection } from 'mongodb';

import type {
  Contact,
  ContactDocument,
  ContactInput,
} from '../types/contact.js';

// Creates and returns a contact with its generated identifier.
export async function createContact(
  contacts: Collection<ContactDocument>,
  input: ContactInput,
) {
  const now = new Date();
  const document: ContactDocument = {
    _id: new ObjectId(),
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  await contacts.insertOne(document);

  return toContact(document);
}

// Returns all contacts ordered from newest to oldest.
export async function listContacts(contacts: Collection<ContactDocument>) {
  const documents = await contacts.find({}).sort({ createdAt: -1 }).toArray();

  return documents.map(toContact);
}

// Returns a contact by identifier when it exists.
export async function getContact(
  contacts: Collection<ContactDocument>,
  contactId: string,
) {
  if (!ObjectId.isValid(contactId)) {
    return null;
  }

  const document = await contacts.findOne({ _id: new ObjectId(contactId) });

  return document ? toContact(document) : null;
}

// Converts a MongoDB contact document into an API contact.
function toContact(document: ContactDocument): Contact {
  return {
    id: document._id.toHexString(),
    name: document.name,
    phoneNumber: document.phoneNumber,
    relation: document.relation,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

// Returns whether a MongoDB write failed because the phone number is already used.
export function isDuplicatePhoneNumber(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

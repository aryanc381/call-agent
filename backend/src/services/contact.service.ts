import { ObjectId } from 'mongodb';
import { MongoServerError } from 'mongodb';
import type { Collection } from 'mongodb';
import type { RequestHandler } from 'express';

import type {
  Contact,
  ContactDocument,
  ContactInput,
} from '../types/contact.js';
import { contactInputSchema } from '../types/contact.js';

export type ContactRouteHandlers = {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
};

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

// Creates the request handlers that connect contact routes to contact services.
export function createContactHandlers(
  contacts: Collection<ContactDocument>,
): ContactRouteHandlers {
  const create: RequestHandler = async (request, response) => {
    const input = contactInputSchema.safeParse(request.body);

    if (!input.success) {
      response.status(400).json({ error: 'Invalid contact input' });
      return;
    }

    try {
      const contact = await createContact(contacts, input.data);
      response.status(201).json({ contact });
    } catch (error) {
      if (isDuplicatePhoneNumber(error)) {
        response.status(409).json({ error: 'Phone number already exists' });
        return;
      }

      response.status(500).json({ error: 'Could not create contact' });
    }
  };

  const list: RequestHandler = async (_request, response) => {
    const contactsList = await listContacts(contacts);
    response.status(200).json({ contacts: contactsList });
  };

  const get: RequestHandler = async (request, response) => {
    const contact = await getContact(
      contacts,
      String(request.params.contactId),
    );

    if (!contact) {
      response.status(404).json({ error: 'Contact not found' });
      return;
    }

    response.status(200).json({ contact });
  };

  return { create, list, get };
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
function isDuplicatePhoneNumber(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

import { Router } from 'express';
import type { Collection } from 'mongodb';

import {
  createContact,
  getContact,
  isDuplicatePhoneNumber,
  listContacts,
} from '../../services/contact.service.js';
import type { ContactDocument } from '../../types/contact.js';
import { contactInputSchema } from '../../types/contact.js';

// Creates the router that calls contact services from contact routes.
export function createContactsRouter(contacts: Collection<ContactDocument>) {
  const router = Router();

  /**
   usage: saves an approved person the agent can call.
   req.body: name, phoneNumber
   res.body: { contact }
   */
  router.post('/', async (request, response) => {
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
  });

  /**
   usage: lists every approved call contact.
   req.body: none
   res.body: { contacts }
   */
  router.get('/', async (_request, response) => {
    const contactsList = await listContacts(contacts);
    response.status(200).json({ contacts: contactsList });
  });

  /**
   usage: gets one approved call contact by identifier.
   req.body: none
   res.body: { contact }
   */
  router.get('/:contactId', async (request, response) => {
    const contact = await getContact(
      contacts,
      String(request.params.contactId),
    );

    if (!contact) {
      response.status(404).json({ error: 'Contact not found' });
      return;
    }

    response.status(200).json({ contact });
  });

  return router;
}

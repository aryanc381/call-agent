import { Router } from 'express';
import type { Collection } from 'mongodb';
import type { RequestHandler } from 'express';

import { createContactsRouter } from './contacts/contacts.route.js';
import type { ContactDocument } from '../types/contact.js';

type RootRouterDependencies = {
  apiKeyAuth: RequestHandler;
  contacts: Collection<ContactDocument>;
};

// Creates the versioned API router that mounts application routes.
export function createRootRouter({
  apiKeyAuth,
  contacts,
}: RootRouterDependencies) {
  const router = Router();

  /**
   usage: mounts protected contact management routes.
   req.body: varies by contact route
   res.body: varies by contact route
   */
  router.use('/contacts', apiKeyAuth, createContactsRouter(contacts));

  return router;
}

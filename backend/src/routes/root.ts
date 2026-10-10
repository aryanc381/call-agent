import { Router } from 'express';
import type { RequestHandler } from 'express';

import { createContactsRouter } from './contacts/contacts.route.js';
import type { ContactRouteHandlers } from '../services/contact.service.js';

type RootRouterDependencies = {
  apiKeyAuth: RequestHandler;
  contacts: ContactRouteHandlers;
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

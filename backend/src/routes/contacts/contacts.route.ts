import { Router } from 'express';

import type { ContactRouteHandlers } from '../../services/contact.service.js';

// Creates the router that binds contact paths to service handlers.
export function createContactsRouter(handlers: ContactRouteHandlers) {
  const router = Router();

  /**
   usage: saves an approved person the agent can call.
   req.body: name, phoneNumber, relation
   res.body: { contact }
   */
  router.post('/', handlers.create);

  /**
   usage: lists every approved call contact.
   req.body: none
   res.body: { contacts }
   */
  router.get('/', handlers.list);

  /**
   usage: gets one approved call contact by identifier.
   req.body: none
   res.body: { contact }
   */
  router.get('/:contactId', handlers.get);

  return router;
}

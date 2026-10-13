import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';

import { createCallTasksRouter } from './call-tasks/call-tasks.route.js';
import { createContactsRouter } from './contacts/contacts.route.js';
import type { ContactDocument } from '../types/contact.js';
import type { CallTaskDocument, CallTaskJob } from '../types/call-task.js';

type RootRouterDependencies = {
  apiKeyAuth: RequestHandler;
  contacts: Collection<ContactDocument>;
  callTasks: Collection<CallTaskDocument>;
  queue: Queue<CallTaskJob>;
  personality: string;
};

// Creates the versioned API router that mounts application routes.
export function createRootRouter({
  apiKeyAuth,
  contacts,
  callTasks,
  queue,
  personality,
}: RootRouterDependencies) {
  const router = Router();

  /**
   usage: mounts protected contact management routes.
   req.body: varies by contact route
   res.body: varies by contact route
   */
  router.use('/contacts', apiKeyAuth, createContactsRouter(contacts));

  /**
   usage: mounts protected calling routes.
   req.body: varies by call-task route
   res.body: varies by call-task route
   */
  router.use(
    '/calls',
    apiKeyAuth,
    createCallTasksRouter({ contacts, callTasks, queue, personality }),
  );

  return router;
}

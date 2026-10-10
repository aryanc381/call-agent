import express from 'express';
import type { RequestHandler } from 'express';
import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';

import { createRootRouter } from './routes/root.js';
import type { ContactDocument } from './types/contact.js';
import type { CallTaskDocument, CallTaskJob } from './types/call-task.js';
import { createVobizWebhookRouter } from './routes/webhooks/vobiz.route.js';

type AppDependencies = {
  apiKeyAuth: RequestHandler;
  contacts: Collection<ContactDocument>;
  callTasks: Collection<CallTaskDocument>;
  queue: Queue<CallTaskJob>;
  isReady: () => Promise<boolean>;
  publicBaseUrl?: string;
};

// Creates the HTTP application with public health routes and protected application routes.
export function createApp({
  apiKeyAuth,
  contacts,
  callTasks,
  queue,
  isReady,
  publicBaseUrl,
}: AppDependencies) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/webhooks/vobiz', createVobizWebhookRouter(publicBaseUrl, callTasks));

  /**
   usage: confirms that the HTTP process is running.
   req.body: none
   res.body: { status }
   */
  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  /**
   usage: confirms that MongoDB and Redis are reachable.
   req.body: none
   res.body: { status }
   */
  app.get('/ready', async (_request, response) => {
    if (await isReady()) {
      response.status(200).json({ status: 'ready' });
      return;
    }

    response.status(503).json({ status: 'unavailable' });
  });

  /**
   usage: mounts version one of the protected personal API.
   req.body: varies by API route
   res.body: varies by API route
   */
  app.use(
    '/v1/api',
    createRootRouter({ apiKeyAuth, contacts, callTasks, queue }),
  );

  return app;
}

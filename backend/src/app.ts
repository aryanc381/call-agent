import express from 'express';
import type { Collection } from 'mongodb';
import type { RequestHandler } from 'express';

import { createContactsRouter } from './routes/contacts.route.js';
import type { ContactDocument } from './types/contact.js';

type AppDependencies = {
  apiKeyAuth: RequestHandler;
  contacts: Collection<ContactDocument>;
  isReady: () => Promise<boolean>;
};

// Creates the HTTP application with public health routes and protected application routes.
export function createApp({ apiKeyAuth, contacts, isReady }: AppDependencies) {
  const app = express();

  app.use(express.json());

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

  app.use('/contacts', apiKeyAuth, createContactsRouter(contacts));

  return app;
}

import express from 'express';
import type { RequestHandler } from 'express';

type AppDependencies = {
  apiKeyAuth: RequestHandler;
  isReady: () => Promise<boolean>;
};

// Creates the HTTP application with public health routes and protected application routes.
export function createApp({ apiKeyAuth, isReady }: AppDependencies) {
  const app = express();

  // usage: confirms that the HTTP process is running.
  // req.body: none
  // res.body: { status }
  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  // usage: confirms that MongoDB and Redis are reachable.
  // req.body: none
  // res.body: { status }
  app.get('/ready', async (_request, response) => {
    if (await isReady()) {
      response.status(200).json({ status: 'ready' });
      return;
    }

    response.status(503).json({ status: 'unavailable' });
  });

  app.use(apiKeyAuth);

  return app;
}

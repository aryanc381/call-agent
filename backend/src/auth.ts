import type { RequestHandler } from 'express';

// Creates middleware that requires the configured personal API key.
export function createApiKeyAuth(apiKey: string): RequestHandler {
  return (request, response, next) => {
    if (request.header('x-api-key') !== apiKey) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}

import { Router } from 'express';

// Creates documented Vobiz answer, stream-status, and hangup callback responses.
export function createVobizWebhookRouter(publicBaseUrl?: string) {
  const router = Router();

  /**
   usage: gives Vobiz the bidirectional media stream instructions.
   req.body: provider form fields
   res.body: VobizXML Stream response
   */
  router.post('/answer/:taskId', (request, response) => {
    if (!publicBaseUrl) {
      response.sendStatus(503);
      return;
    }
    const baseUrl = publicBaseUrl;
    const streamUrl = `${baseUrl.replace(/^http/, 'ws')}/webhooks/vobiz/media/${request.params.taskId}`;
    const statusUrl = `${baseUrl}/webhooks/vobiz/stream-status/${request.params.taskId}`;
    response.type('application/xml').send(`<?xml version="1.0"?><Response><Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" statusCallbackUrl="${statusUrl}" statusCallbackMethod="POST">${streamUrl}</Stream></Response>`);
  });

  /**
   usage: accepts Vobiz stream lifecycle notifications.
   req.body: provider form fields
   res.body: none
   */
  router.post('/stream-status/:taskId', (_request, response) => response.sendStatus(204));

  /**
   usage: accepts the terminal Vobiz callback.
   req.body: provider form fields
   res.body: none
   */
  router.post('/hangup/:taskId', (_request, response) => response.sendStatus(204));
  return router;
}

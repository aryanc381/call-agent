import { Router } from 'express';
import type { Collection } from 'mongodb';
import type { CallTaskDocument } from '../../types/call-task.js';
import { failProviderCallTask } from '../../services/call-task.service.js';

// Creates documented Vobiz answer, stream-status, and hangup callback responses.
export function createVobizWebhookRouter(publicBaseUrl: string | undefined, callTasks: Collection<CallTaskDocument>) {
  const router = Router();

  /**
   usage: gives Vobiz the bidirectional media stream instructions.
   req.body: provider form fields
   res.body: VobizXML Stream response
   */
  router.post('/answer/:taskId', (request, response) => {
    console.log(`[vobiz] answer callback task=${request.params.taskId}`);
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
  router.post('/stream-status/:taskId', async (request, response) => {
    console.log(`[vobiz] stream status task=${request.params.taskId} status=${request.body?.StreamStatus ?? request.body?.Event ?? 'unknown'}`);
    if (request.body?.StreamStatus === 'failed') await failProviderCallTask(callTasks, request.params.taskId, 'Vobiz media stream failed');
    response.sendStatus(204);
  });

  /**
   usage: accepts the terminal Vobiz callback.
   req.body: provider form fields
   res.body: none
   */
  router.post('/hangup/:taskId', async (request, response) => {
    console.log(`[vobiz] hangup callback task=${request.params.taskId} cause=${request.body?.HangupCause ?? 'unknown'}`);
    const hangupCause = String(request.body?.HangupCause ?? '').toLowerCase().replaceAll('_', ' ');
    if (hangupCause && hangupCause !== 'normal clearing') await failProviderCallTask(callTasks, request.params.taskId, String(request.body.HangupCause));
    response.sendStatus(204);
  });
  return router;
}

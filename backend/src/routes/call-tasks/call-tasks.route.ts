import { Router } from 'express';
import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';

import { createCallTask, getCallTask } from '../../services/call-task.service.js';
import { getContact } from '../../services/contact.service.js';
import type { ContactDocument } from '../../types/contact.js';
import { callTaskInputSchema, type CallTaskDocument, type CallTaskJob } from '../../types/call-task.js';

type CallRouteDependencies = { contacts: Collection<ContactDocument>; callTasks: Collection<CallTaskDocument>; queue: Queue<CallTaskJob>; personality: string };

// Creates the small API that immediately starts a call.
export function createCallTasksRouter({ contacts, callTasks, queue, personality }: CallRouteDependencies) {
  const router = Router();
  /**
   * usage: dials one saved contact with the configured agent personality.
   * req.body: contactId, context
   * res.body: { call }
   */
  router.post('/', async (request, response) => {
    const idempotencyKey = request.header('Idempotency-Key')?.trim();
    const input = callTaskInputSchema.safeParse(request.body);
    if (!idempotencyKey || !input.success) return void response.status(400).json({ error: 'contactId, context, and Idempotency-Key are required' });
    const contact = await getContact(contacts, input.data.contactId);
    if (!contact) return void response.status(404).json({ error: 'Contact not found' });
    try {
      const created = await createCallTask(callTasks, queue, input.data, idempotencyKey, personality);
      if (!created.created) return void response.status(200).json({ call: created.task });
      response.status(202).json({ call: created.task });
    } catch {
      response.status(500).json({ error: 'Could not queue call' });
    }
  });
  /**
   * usage: gets one call and its transcript when complete.
   * req.body: none
   * res.body: { call }
   */
  router.get('/:callId', async (request, response) => {
    const call = await getCallTask(callTasks, String(request.params.callId));
    if (!call) return void response.status(404).json({ error: 'Call not found' });
    response.status(200).json({ call });
  });
  return router;
}

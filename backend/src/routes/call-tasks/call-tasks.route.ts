import { Router } from 'express';
import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';

import { getContact } from '../../services/contact.service.js';
import {
  createCallTask,
  getCallTask,
} from '../../services/call-task.service.js';
import type { ContactDocument } from '../../types/contact.js';
import {
  callTaskInputSchema,
  type CallTaskDocument,
  type CallTaskJob,
} from '../../types/call-task.js';

type CallTaskRouteDependencies = {
  contacts: Collection<ContactDocument>;
  callTasks: Collection<CallTaskDocument>;
  queue: Queue<CallTaskJob>;
};

// Creates the router that calls call-task services from task routes.
export function createCallTasksRouter({
  contacts,
  callTasks,
  queue,
}: CallTaskRouteDependencies) {
  const router = Router();

  /**
   usage: creates and queues a call task for an approved contact.
   req.body: contactId, relation, question, context, personality, isFirstCall
   res.body: { task }
   */
  router.post('/', async (request, response) => {
    const idempotencyKey = request.header('Idempotency-Key')?.trim();
    const input = callTaskInputSchema.safeParse(request.body);

    if (!idempotencyKey || !input.success) {
      response.status(400).json({ error: 'Invalid call task input' });
      return;
    }

    const contact = await getContact(contacts, input.data.contactId);

    if (!contact) {
      response.status(404).json({ error: 'Contact not found' });
      return;
    }

    try {
      const task = await createCallTask(
        callTasks,
        queue,
        input.data,
        idempotencyKey,
      );
      response.status(202).json({ task });
    } catch {
      response.status(500).json({ error: 'Could not create call task' });
    }
  });

  /**
   usage: gets one call task and its current queue status.
   req.body: none
   res.body: { task }
   */
  router.get('/:taskId', async (request, response) => {
    const task = await getCallTask(callTasks, String(request.params.taskId));

    if (!task) {
      response.status(404).json({ error: 'Call task not found' });
      return;
    }

    response.status(200).json({ task });
  });

  return router;
}

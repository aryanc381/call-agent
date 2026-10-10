import { ObjectId } from 'mongodb';
import { MongoServerError } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';

import type {
  CallTask,
  CallTaskDocument,
  CallTaskInput,
  CallTaskJob,
} from '../types/call-task.js';

// Creates a queued call task and adds one matching job to BullMQ.
export async function createCallTask(
  callTasks: Collection<CallTaskDocument>,
  queue: Queue<CallTaskJob>,
  input: CallTaskInput,
  idempotencyKey: string,
) {
  const existingTask = await callTasks.findOne({ idempotencyKey });

  if (existingTask) {
    return { task: toCallTask(existingTask), created: false };
  }

  const now = new Date();
  const document: CallTaskDocument = {
    _id: new ObjectId(),
    idempotencyKey,
    contactId: new ObjectId(input.contactId),
    request: {
      relation: input.relation,
      question: input.question,
      context: input.context,
      personality: input.personality,
      isFirstCall: input.isFirstCall,
    },
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await callTasks.insertOne(document);
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error;
    }

    const duplicateTask = await callTasks.findOne({ idempotencyKey });

    if (!duplicateTask) {
      throw error;
    }

    return { task: toCallTask(duplicateTask), created: false };
  }

  await queue.add(
    'call-task',
    { taskId: document._id.toHexString() },
    {
      jobId: document._id.toHexString(),
    },
  );

  return { task: toCallTask(document), created: true };
}

// Returns one call task by identifier when it exists.
export async function getCallTask(
  callTasks: Collection<CallTaskDocument>,
  taskId: string,
) {
  if (!ObjectId.isValid(taskId)) {
    return null;
  }

  const document = await callTasks.findOne({ _id: new ObjectId(taskId) });

  return document ? toCallTask(document) : null;
}

// Converts a MongoDB task document into an API task.
function toCallTask(document: CallTaskDocument): CallTask {
  return {
    id: document._id.toHexString(),
    idempotencyKey: document.idempotencyKey,
    contactId: document.contactId.toHexString(),
    request: document.request,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

// Returns whether a MongoDB write failed because a key already exists.
function isDuplicateKey(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

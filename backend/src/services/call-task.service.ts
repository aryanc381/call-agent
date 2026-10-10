import { ObjectId } from 'mongodb';
import { MongoServerError } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';

import type {
  CallTask,
  CallTaskDocument,
  CallTaskInput,
  CallTaskJob,
  CallTaskResult,
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
      greeting: input.greeting,
      isFirstCall: input.isFirstCall,
    },
    status: 'queued',
    processing: null,
    provider: null,
    result: null,
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

// Atomically claims a queued task for one worker.
export async function claimCallTask(
  callTasks: Collection<CallTaskDocument>,
  taskId: string,
  workerId: string,
  claimToken: string,
  leaseMilliseconds: number,
) {
  if (!ObjectId.isValid(taskId)) {
    return null;
  }

  const claimedAt = new Date();
  const result = await callTasks.updateOne(
    { _id: new ObjectId(taskId), status: 'queued' },
    {
      $set: {
        status: 'processing',
        processing: {
          workerId,
          claimToken,
          claimedAt,
          leaseExpiresAt: new Date(claimedAt.getTime() + leaseMilliseconds),
        },
        updatedAt: claimedAt,
      },
    },
  );

  if (result.modifiedCount !== 1) {
    return null;
  }

  const document = await callTasks.findOne({ _id: new ObjectId(taskId) });

  return document ? toCallTask(document) : null;
}

// Marks a claimed task as completed and stores its simulated result.
export async function completeCallTask(
  callTasks: Collection<CallTaskDocument>,
  taskId: string,
  claimToken: string,
  taskResult: CallTaskResult,
) {
  const result = await callTasks.updateOne(
    {
      _id: new ObjectId(taskId),
      status: 'processing',
      'processing.claimToken': claimToken,
    },
    {
      $set: {
        status: 'completed',
        processing: null,
        result: taskResult,
        updatedAt: taskResult.endedAt,
      },
    },
  );

  return result.modifiedCount === 1;
}

// Stores the provider identifier after an outbound call is accepted.
export async function markCallTaskDialing(
  callTasks: Collection<CallTaskDocument>,
  taskId: string,
  claimToken: string,
  vobizCallId: string,
) {
  return callTasks.updateOne(
    { _id: new ObjectId(taskId), status: 'processing', 'processing.claimToken': claimToken },
    { $set: { status: 'dialing', provider: { vobizCallId, startedAt: new Date() }, updatedAt: new Date() } },
  );
}

// Marks a provider stream connected after Vobiz sends its start event.
export async function markCallTaskConnected(callTasks: Collection<CallTaskDocument>, taskId: string) {
  return callTasks.updateOne({ _id: new ObjectId(taskId), status: 'dialing' }, { $set: { status: 'connected', updatedAt: new Date() } });
}

// Stores a terminal result from the provider media bridge.
export async function completeProviderCallTask(callTasks: Collection<CallTaskDocument>, taskId: string, result: CallTaskResult) {
  return callTasks.updateOne({ _id: new ObjectId(taskId), status: { $in: ['connected', 'dialing'] } }, { $set: { status: 'completed', processing: null, result, updatedAt: result.endedAt } });
}

// Stores a terminal provider failure from the media bridge or callback path.
export async function failProviderCallTask(callTasks: Collection<CallTaskDocument>, taskId: string, failureReason: string) {
  const endedAt = new Date();
  return callTasks.updateOne({ _id: new ObjectId(taskId), status: { $in: ['connected', 'dialing', 'processing'] } }, { $set: { status: 'failed', processing: null, result: { endedAt, failureReason }, updatedAt: endedAt } });
}

// Marks a claimed task as failed and stores the execution error.
export async function failCallTask(
  callTasks: Collection<CallTaskDocument>,
  taskId: string,
  claimToken: string,
  failureReason: string,
  providerError: string,
) {
  const endedAt = new Date();
  const result = await callTasks.updateOne(
    {
      _id: new ObjectId(taskId),
      status: 'processing',
      'processing.claimToken': claimToken,
    },
    {
      $set: {
        status: 'failed',
        processing: null,
        result: { endedAt, failureReason, providerError },
        updatedAt: endedAt,
      },
    },
  );

  return result.modifiedCount === 1;
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
    processing: document.processing,
    provider: document.provider ?? null,
    result: document.result,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

// Returns whether a MongoDB write failed because a key already exists.
function isDuplicateKey(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

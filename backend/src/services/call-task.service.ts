import { MongoServerError, ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';

import type { CallTask, CallTaskDocument, CallTaskInput, CallTaskJob, CallTaskResult } from '../types/call-task.js';

// Saves one outbound call before it is sent to the phone provider.
export async function createCallTask(callTasks: Collection<CallTaskDocument>, queue: Queue<CallTaskJob>, input: CallTaskInput, idempotencyKey: string, personality: string) {
  const existing = await callTasks.findOne({ idempotencyKey });
  if (existing) return { task: toCallTask(existing), created: false };
  const now = new Date();
  const document: CallTaskDocument = { _id: new ObjectId(), idempotencyKey, contactId: new ObjectId(input.contactId), request: { personality, context: input.context }, status: 'queued', processing: null, provider: null, result: null, createdAt: now, updatedAt: now };
  try { await callTasks.insertOne(document); } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
    const duplicate = await callTasks.findOne({ idempotencyKey });
    if (!duplicate) throw error;
    return { task: toCallTask(duplicate), created: false };
  }
  await queue.add('call-task', { taskId: document._id.toHexString() }, { jobId: document._id.toHexString() });
  return { task: toCallTask(document), created: true };
}

// Claims a queued call so only one worker can dial it.
export async function claimCallTask(callTasks: Collection<CallTaskDocument>, taskId: string, workerId: string, claimToken: string, leaseMilliseconds: number) {
  if (!ObjectId.isValid(taskId)) return null;
  const claimedAt = new Date();
  const claimed = await callTasks.findOneAndUpdate({ _id: new ObjectId(taskId), status: 'queued' }, { $set: { status: 'processing', processing: { workerId, claimToken, claimedAt, leaseExpiresAt: new Date(claimedAt.getTime() + leaseMilliseconds) }, updatedAt: claimedAt } }, { returnDocument: 'after' });
  return claimed ? toCallTask(claimed) : null;
}

// Stores the provider call identifier once dialing has been accepted.
export function markCallTaskDialing(callTasks: Collection<CallTaskDocument>, taskId: string, claimToken: string, vobizCallId: string) {
  return callTasks.updateOne({ _id: new ObjectId(taskId), status: 'processing', 'processing.claimToken': claimToken }, { $set: { status: 'dialing', provider: { vobizCallId, startedAt: new Date() }, updatedAt: new Date() } });
}

// Marks the call as connected when its media stream starts.
export function markCallTaskConnected(callTasks: Collection<CallTaskDocument>, taskId: string) {
  return callTasks.updateOne({ _id: new ObjectId(taskId), status: 'dialing' }, { $set: { status: 'connected', updatedAt: new Date() } });
}

// Stores a finished conversation and its transcript.
export function completeProviderCallTask(callTasks: Collection<CallTaskDocument>, taskId: string, result: CallTaskResult) {
  return callTasks.updateOne({ _id: new ObjectId(taskId), status: { $in: ['connected', 'dialing'] } }, { $set: { status: 'completed', processing: null, result, updatedAt: result.endedAt } });
}

// Stores a provider failure for a call that never completed.
export function failProviderCallTask(callTasks: Collection<CallTaskDocument>, taskId: string, failureReason: string) {
  const endedAt = new Date();
  return callTasks.updateOne({ _id: new ObjectId(taskId), status: { $in: ['connected', 'dialing', 'processing'] } }, { $set: { status: 'failed', processing: null, result: { endedAt, failureReason }, updatedAt: endedAt } });
}

// Returns one persisted call by identifier.
export async function getCallTask(callTasks: Collection<CallTaskDocument>, taskId: string) {
  if (!ObjectId.isValid(taskId)) return null;
  const document = await callTasks.findOne({ _id: new ObjectId(taskId) });
  return document ? toCallTask(document) : null;
}

// Converts a MongoDB document to the public call shape.
function toCallTask(document: CallTaskDocument): CallTask {
  return { id: document._id.toHexString(), idempotencyKey: document.idempotencyKey, contactId: document.contactId.toHexString(), request: document.request, status: document.status, processing: document.processing, provider: document.provider, result: document.result, createdAt: document.createdAt, updatedAt: document.updatedAt };
}

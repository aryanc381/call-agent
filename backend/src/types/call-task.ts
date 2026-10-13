import type { ObjectId } from 'mongodb';
import { z } from 'zod';

export const callTaskInputSchema = z.object({ contactId: z.string().trim().min(1), context: z.string().trim().min(1).max(2_000) }).strict();
export type CallTaskInput = z.infer<typeof callTaskInputSchema>;
export type CallTaskStatus = 'queued' | 'processing' | 'dialing' | 'connected' | 'completed' | 'failed';
export type CallTaskRequest = { personality: string; context: string };
export type ConversationMessage = { role: 'user' | 'assistant'; content: string };
export type CallTaskTranscriptEntry = { speaker: 'agent' | 'contact'; text: string; startedAtMs: number; endedAtMs: number };
export type CallTaskResult = { transcript?: CallTaskTranscriptEntry[]; durationSeconds?: number; endedAt: Date; failureReason?: string };
export type CallTaskProvider = { vobizCallId?: string; startedAt?: Date };
export type CallTaskProcessing = { workerId: string; claimToken: string; claimedAt: Date; leaseExpiresAt: Date };
export type CallTaskDocument = { _id: ObjectId; idempotencyKey: string; contactId: ObjectId; request: CallTaskRequest; status: CallTaskStatus; processing: CallTaskProcessing | null; provider: CallTaskProvider | null; result: CallTaskResult | null; createdAt: Date; updatedAt: Date };
export type CallTask = Omit<CallTaskDocument, '_id' | 'contactId'> & { id: string; contactId: string };
export type CallTaskJob = { taskId: string };

import type { ObjectId } from 'mongodb';
import { z } from 'zod';

const relationshipValues = [
  'mother',
  'father',
  'sibling',
  'friend',
  'colleague',
  'other',
] as const;

const closenessValues = [
  'inner_circle',
  'close',
  'familiar',
  'formal',
] as const;

const callTaskRelationSchema = z
  .object({
    relationship: z.enum(relationshipValues),
    description: z.string().trim().min(1).max(200),
    closeness: z.enum(closenessValues),
  })
  .strict();

export const callTaskInputSchema = z
  .object({
    contactId: z.string().trim().min(1),
    relation: callTaskRelationSchema,
    question: z.string().trim().min(1).max(500),
    context: z.string().trim().min(1).max(2_000),
    personality: z.string().trim().min(1).max(500),
    isFirstCall: z.boolean(),
  })
  .strict();

export type CallTaskInput = z.infer<typeof callTaskInputSchema>;
export type CallTaskStatus =
  'queued' | 'processing' | 'dialing' | 'connected' | 'completed' | 'failed';

export type CallTaskRequest = Omit<CallTaskInput, 'contactId'>;

export type CallTaskProcessing = {
  workerId: string;
  claimToken: string;
  claimedAt: Date;
  leaseExpiresAt: Date;
};

export type CallTaskTranscriptEntry = {
  speaker: 'agent' | 'contact';
  text: string;
  startedAtMs: number;
  endedAtMs: number;
};

export type CallTaskResult = {
  confirmedAnswer?: string;
  transcript?: CallTaskTranscriptEntry[];
  durationSeconds?: number;
  endedAt: Date;
  failureReason?: string;
  providerError?: string;
};

export type CallTaskProvider = {
  vobizCallId?: string;
  bolnaCallId?: string;
  startedAt?: Date;
};

export type CallTaskDocument = {
  _id: ObjectId;
  idempotencyKey: string;
  contactId: ObjectId;
  request: CallTaskRequest;
  status: CallTaskStatus;
  processing: CallTaskProcessing | null;
  provider: CallTaskProvider | null;
  result: CallTaskResult | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CallTask = Omit<CallTaskDocument, '_id' | 'contactId'> & {
  id: string;
  contactId: string;
};

export type CallTaskJob = {
  taskId: string;
};

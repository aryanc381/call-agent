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

export const contactInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/),
    relation: z
      .object({
        relationship: z.enum(relationshipValues),
        closeness: z.enum(closenessValues),
      })
      .strict(),
  })
  .strict();

export type ContactInput = z.infer<typeof contactInputSchema>;

export type Contact = ContactInput & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ContactDocument = ContactInput & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

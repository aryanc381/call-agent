import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PERSONAL_API_KEY: z.string().min(1),
  AGENT_PERSONALITY: z
    .string()
    .trim()
    .min(1)
    .default("You are Aryan's warm, concise calling assistant. Speak naturally and helpfully."),
  VOBIZ_AUTH_ID: z.string().optional(),
  VOBIZ_AUTH_TOKEN: z.string().optional(),
  VOBIZ_BASE_URL: z.union([z.literal(''), z.string().url()]).optional(),
  VOBIZ_FROM_NUMBER: z.string().optional(),
  PUBLIC_BASE_URL: z.union([z.literal(''), z.string().url()]).optional(),
  BOLNA_BASE_URL: z.union([z.literal(''), z.string().url()]).optional(),
  MEDIA_SERVICE_BASE_URL: z.union([z.literal(''), z.string().url()]).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

// Exposes the validated environment values used by the backend.
export const env = {
  port: parsed.data.PORT,
  mongodbUri: parsed.data.MONGODB_URI,
  redisUrl: parsed.data.REDIS_URL,
  personalApiKey: parsed.data.PERSONAL_API_KEY,
  agentPersonality: parsed.data.AGENT_PERSONALITY,
  vobizAuthId: parsed.data.VOBIZ_AUTH_ID,
  vobizAuthToken: parsed.data.VOBIZ_AUTH_TOKEN,
  vobizBaseUrl: parsed.data.VOBIZ_BASE_URL,
  vobizFromNumber: parsed.data.VOBIZ_FROM_NUMBER,
  publicBaseUrl: parsed.data.PUBLIC_BASE_URL,
  bolnaBaseUrl: parsed.data.BOLNA_BASE_URL,
  mediaServiceBaseUrl: parsed.data.MEDIA_SERVICE_BASE_URL,
};

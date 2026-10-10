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
};

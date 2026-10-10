import type { CallTaskRequest } from '../types/call-task.js';
import { env } from '../utils/env.js';

type SessionResponse = { sessionId: string; transcript: string; answer: string; audioBase64: string; audioContentType: string };
type SessionInput = CallTaskRequest & { contact: { name: string; relation: string; relationDescription: string; closeness: string } };

// Sends one audio turn to the Python media plane's stable session contract.
export async function runBolnaSession(request: SessionInput, audioBase64: string, audioContentType: string) {
  if (!env.mediaServiceBaseUrl) throw new Error('Media service base URL is not configured');
  const response = await fetch(`${env.mediaServiceBaseUrl}/v1/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, audioContentType, ...request }),
  });
  if (!response.ok) throw new Error(`Bolna session failed with ${response.status}`);
  return (await response.json()) as SessionResponse;
}

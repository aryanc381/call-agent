import type { CallTaskRequest } from '../types/call-task.js';
import { env } from '../utils/env.js';

type SessionResponse = { sessionId: string; transcript: string; answer: string; audioBase64: string; audioContentType: string };
type SessionInput = CallTaskRequest & { contact: { name: string; relation: string; relationDescription: string; closeness: string } };

// Sends one audio turn to the Python media plane's stable session contract.
export async function runBolnaSession(request: SessionInput, audioBase64: string, audioContentType: string) {
  if (!env.mediaServiceBaseUrl) throw new Error('Media service base URL is not configured');
  console.log(`[media] request start contentType=${audioContentType} audioChars=${audioBase64.length}`);
  const response = await fetch(`${env.mediaServiceBaseUrl}/v1/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, audioContentType, ...request }),
  });
  console.log(`[media] response status=${response.status}`);
  if (!response.ok) {
    const detail = await response.text();
    console.error(`[media] response error status=${response.status} detail=${detail.slice(0, 500)}`);
    throw new Error(`Media session failed with ${response.status}`);
  }
  return (await response.json()) as SessionResponse;
}

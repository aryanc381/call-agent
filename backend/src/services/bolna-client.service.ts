import type { CallTaskRequest, ConversationMessage } from '../types/call-task.js';
import { env } from '../utils/env.js';

type SessionResponse = { sessionId: string; transcript: string; answer: string; audioBase64: string; audioContentType: string };
type SessionInput = CallTaskRequest & { contact: { name: string; context: string } };

// Sends one audio turn to the Python media plane's stable session contract.
export async function runBolnaSession(request: SessionInput, audioBase64: string | undefined, audioContentType: string | undefined, conversationHistory: ConversationMessage[]) {
  if (!env.mediaServiceBaseUrl) throw new Error('Media service base URL is not configured');
  console.log(`[media] request start contentType=${audioContentType ?? 'none'} audioChars=${audioBase64?.length ?? 0} history=${conversationHistory.length}`);
  const response = await fetch(`${env.mediaServiceBaseUrl}/v1/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, audioContentType, conversationHistory, ...request }),
  });
  console.log(`[media] response status=${response.status}`);
  if (!response.ok) {
    const detail = await response.text();
    console.error(`[media] response error status=${response.status} detail=${detail.slice(0, 500)}`);
    throw new Error(`Media session failed with ${response.status}`);
  }
  const session: unknown = await response.json();
  if (!isSessionResponse(session)) throw new Error('Media service returned an invalid session response');
  return session;
}

// Rejects malformed media responses before their completion flag can control a call.
function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return typeof session.sessionId === 'string'
    && typeof session.transcript === 'string'
    && typeof session.answer === 'string'
    && typeof session.audioBase64 === 'string'
    && typeof session.audioContentType === 'string';
}

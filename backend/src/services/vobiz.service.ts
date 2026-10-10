import { env } from '../utils/env.js';

type VobizCallInput = { to: string; answerUrl: string; hangupUrl: string };

function getConfig() {
  if (!env.vobizAuthId || !env.vobizAuthToken || !env.vobizBaseUrl || !env.vobizFromNumber) {
    throw new Error('Vobiz configuration is incomplete');
  }
  return { id: env.vobizAuthId, token: env.vobizAuthToken, baseUrl: env.vobizBaseUrl, from: env.vobizFromNumber };
}

// Creates one outbound Vobiz call using the documented Account/{id}/Call contract.
export async function createVobizCall({ to, answerUrl, hangupUrl }: VobizCallInput) {
  const settings = getConfig();
  const response = await fetch(`${settings.baseUrl}/Account/${settings.id}/Call/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-ID': settings.id, 'X-Auth-Token': settings.token },
    body: JSON.stringify({ from: settings.from, to, answer_url: answerUrl, answer_method: 'POST', hangup_url: hangupUrl, hangup_method: 'POST' }),
  });
  if (!response.ok) throw new Error(`Vobiz call failed with ${response.status}`);
  const body = (await response.json()) as { request_uuid?: string; call_uuid?: string };
  const callId = body.request_uuid ?? body.call_uuid;
  if (!callId) throw new Error('Vobiz response did not include a call identifier');
  return callId;
}

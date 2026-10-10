export type VobizMediaEvent = { event: 'media'; media: { payload: string } };

// Converts a Vobiz base64 μ-law media event into the audio payload sent to Bolna.
export function decodeVobizAudio(event: VobizMediaEvent) {
  return Buffer.from(event.media.payload, 'base64');
}

// Encodes provider audio as the base64 payload expected by Vobiz's playAudio event.
export function encodeVobizAudio(audio: Buffer) {
  return { event: 'playAudio', media: { payload: audio.toString('base64') } };
}

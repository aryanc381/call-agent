// Converts one Vobiz 8 kHz μ-law sample into signed 16-bit PCM.
export function muLawToPcm(sample: number) {
  const value = ~sample & 0xff;
  const sign = value & 0x80 ? -1 : 1;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  return sign * (((mantissa << 3) + 132) << exponent) - sign * 132;
}

// Converts signed 16-bit PCM into one Vobiz 8 kHz μ-law sample.
export function pcmToMuLaw(sample: number) {
  const sign = sample < 0 ? 0x80 : 0;
  let magnitude = Math.min(Math.abs(sample), 32635) + 132;
  let exponent = 7;
  for (; exponent > 0 && (magnitude & (0x80 << exponent)) === 0; exponent -= 1) {}
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// Decodes a base64 Vobiz μ-law frame into a PCM16 WAV payload for the Python service.
export function muLawToWav(payloads: Buffer[]) {
  const pcm = Buffer.concat(payloads.map((payload) => {
    const output = Buffer.alloc(payload.length * 2);
    payload.forEach((sample, index) => output.writeInt16LE(muLawToPcm(sample), index * 2));
    return output;
  }));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Converts a Cartesia PCM16 WAV response into the μ-law payload Vobiz expects.
export function wavToMuLaw(wav: Buffer) {
  const dataOffset = wav.indexOf(Buffer.from('data'));
  if (dataOffset < 0) throw new Error('Cartesia response is not a WAV payload');
  const pcm = wav.subarray(dataOffset + 8);
  const output = Buffer.alloc(Math.floor(pcm.length / 2));
  for (let index = 0; index < output.length; index += 1) output[index] = pcmToMuLaw(pcm.readInt16LE(index * 2));
  return output;
}

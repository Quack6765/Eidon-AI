export function convertFloat32ToPcm16(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 32768 : clamped * 32767;
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, Math.round(value), true);
  });

  return buffer;
}

export function encodeFloat32ToWav(samples: Float32Array, sampleRate: number) {
  const pcm = convertFloat32ToPcm16(samples);
  const headerBytes = 44;
  const buffer = new ArrayBuffer(headerBytes + pcm.byteLength);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * Int16Array.BYTES_PER_ELEMENT, true);
  view.setUint16(32, Int16Array.BYTES_PER_ELEMENT, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, headerBytes).set(new Uint8Array(pcm));

  return buffer;
}

export async function readBoundedFloat32Audio(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Audio recording is too long.");
  }
  if (!request.body) {
    throw new Error("Invalid audio recording.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Audio recording is too long.");
    }
    chunks.push(value);
  }

  if (totalBytes === 0 || totalBytes % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Invalid audio recording.");
  }

  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const samples = new Float32Array(
    audio.buffer,
    audio.byteOffset,
    audio.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < -1 || sample > 1) {
      throw new Error("Invalid audio samples.");
    }
  }

  return samples;
}

export function isRecordedSpeechAudioError(error: unknown): error is Error {
  return error instanceof Error && [
    "Audio recording is too long.",
    "Invalid audio recording.",
    "Invalid audio samples."
  ].includes(error.message);
}

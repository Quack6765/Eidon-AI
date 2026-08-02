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

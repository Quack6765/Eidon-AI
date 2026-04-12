export function appendTranscriptToDraft(current: string, transcript: string) {
  const trimmedTranscript = transcript.trim();

  if (!trimmedTranscript) {
    return current;
  }

  if (!current.trim()) {
    return trimmedTranscript;
  }

  return `${current.replace(/\s+$/, "")}\n${trimmedTranscript}`;
}

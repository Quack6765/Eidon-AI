import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { MAX_CHAT_MESSAGE_CHARS } from "@/lib/constants";
import {
  cleanSpeechTranscript,
  isSpeechCleanupUnavailableError
} from "@/lib/speech/cleanup";

export const runtime = "nodejs";

const inputSchema = z.object({
  transcript: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS)
});

export async function POST(request: Request) {
  const user = await requireUser(false);
  if (!user) return badRequest("Authentication required", 401);
  const body = inputSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return badRequest("A non-empty transcript is required.");
  }
  try {
    const result = await cleanSpeechTranscript({
      transcript: body.data.transcript,
      signal: request.signal
    });
    return ok(result);
  } catch (error) {
    if (isSpeechCleanupUnavailableError(error)) return badRequest(error.message, 409);
    console.error("[speech] AI post-cleanup failed:", error);
    return badRequest("AI post-cleanup failed.", 500);
  }
}

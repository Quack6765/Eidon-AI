import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { RequestBodyTooLargeError, readRequestBodyWithLimit } from "@/lib/bounded-request";
import { runAssistantTurn } from "@/lib/chat-turn";
import { MAX_ATTACHMENT_IDS_PER_MESSAGE, MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_REQUEST_BYTES } from "@/lib/constants";
import { getConversation } from "@/lib/conversations";
import { badRequest, parseRouteParams, payloadTooLarge } from "@/lib/http";
import { encodeSseEvent, encodeSseFlushMarker, encodeSsePrelude } from "@/lib/sse";

const bodySchema = z.object({
  message: z.string().max(
    MAX_CHAT_MESSAGE_CHARS,
    `Message exceeds the maximum length of ${MAX_CHAT_MESSAGE_CHARS} characters`
  ),
  attachmentIds: z
    .array(z.string().min(1))
    .max(
      MAX_ATTACHMENT_IDS_PER_MESSAGE,
      `A maximum of ${MAX_ATTACHMENT_IDS_PER_MESSAGE} attachments may be sent per message`
    )
    .default([])
}).refine(
  (value) => value.message.trim().length > 0 || value.attachmentIds.length > 0,
  "Chat message or attachment is required"
);
const paramsSchema = z.object({ conversationId: z.string().min(1) });

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser(false);
  if (!user) return badRequest("Authentication required", 401);
  const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(
      Buffer.from(await readRequestBodyWithLimit(request, MAX_CHAT_REQUEST_BYTES)).toString("utf8")
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return payloadTooLarge(error.message);
    return badRequest("Invalid chat payload");
  }
  const payload = bodySchema.safeParse(parsedBody);
  if (!payload.success) {
    const limitIssue = payload.error.issues.find((issue) => issue.code === "too_big");
    return badRequest(limitIssue ? limitIssue.message : "Invalid chat payload");
  }
  const conversation = getConversation(params.conversationId, user.id);
  if (!conversation) return badRequest("Conversation not found", 404);

  const encoder = new TextEncoder();
  const turnAbortController = new AbortController();
  const abortTurn = () => turnAbortController.abort();
  request.signal.addEventListener("abort", abortTurn, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(encodeSsePrelude()));
      for await (const event of runAssistantTurn({
        conversationId: conversation.id,
        content: payload.data.message,
        attachmentIds: payload.data.attachmentIds,
        abortSignal: turnAbortController.signal
      })) {
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
        if (event.type !== "thinking_delta") {
          controller.enqueue(encoder.encode(encodeSseFlushMarker()));
        }
      }
      request.signal.removeEventListener("abort", abortTurn);
      controller.close();
    },
    cancel() {
      turnAbortController.abort();
      request.signal.removeEventListener("abort", abortTurn);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

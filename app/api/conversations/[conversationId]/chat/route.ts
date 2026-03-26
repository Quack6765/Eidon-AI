import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  createMessage,
  getConversation,
  maybeRetitleConversationFromFirstUserMessage,
  updateAssistantMessage
} from "@/lib/conversations";
import { ensureCompactedContext } from "@/lib/compaction";
import { badRequest } from "@/lib/http";
import { getSettingsWithApiKey } from "@/lib/settings";
import { encodeSseEvent } from "@/lib/sse";
import { estimateTextTokens } from "@/lib/tokenization";
import { streamProviderResponse } from "@/lib/provider";
import type { ChatStreamEvent } from "@/lib/types";

const bodySchema = z.object({
  message: z.string().min(1)
});

const paramsSchema = z.object({
  conversationId: z.string().min(1)
});

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  const payload = bodySchema.safeParse(await request.json());

  if (!payload.success) {
    return badRequest("Invalid chat payload");
  }

  const conversation = getConversation(params.data.conversationId);

  if (!conversation) {
    return badRequest("Conversation not found", 404);
  }

  const settings = getSettingsWithApiKey();

  if (!settings.apiKey) {
    return badRequest("Set an API key in settings before starting a chat");
  }

  const userMessage = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: payload.data.message,
    estimatedTokens: estimateTextTokens(payload.data.message)
  });

  maybeRetitleConversationFromFirstUserMessage(conversation.id);

  const assistantMessage = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "streaming",
    estimatedTokens: 0
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };

      try {
        const compacted = await ensureCompactedContext(conversation.id);

        if (compacted.compactionNoticeEvent) {
          write(compacted.compactionNoticeEvent);
        }

        write({
          type: "message_start",
          messageId: assistantMessage.id
        });

        const providerStream = streamProviderResponse({
          settings,
          promptMessages: compacted.promptMessages
        });

        let finalAnswer = "";
        let finalThinking = "";
        let finalUsage: {
          inputTokens?: number;
          outputTokens?: number;
          reasoningTokens?: number;
        } = {};

        while (true) {
          const next = await providerStream.next();

          if (next.done) {
            finalAnswer = next.value.answer;
            finalThinking = next.value.thinking;
            finalUsage = next.value.usage;
            break;
          }

          if (next.value.type === "answer_delta") {
            finalAnswer += next.value.text;
          }

          if (next.value.type === "thinking_delta") {
            finalThinking += next.value.text;
          }

          if (next.value.type === "usage") {
            finalUsage = {
              inputTokens: next.value.inputTokens,
              outputTokens: next.value.outputTokens,
              reasoningTokens: next.value.reasoningTokens
            };
          }

          write(next.value);
        }

        updateAssistantMessage(assistantMessage.id, {
          content: finalAnswer,
          thinkingContent: finalThinking,
          status: "completed",
          estimatedTokens:
            (finalUsage.inputTokens ?? 0) +
            (finalUsage.outputTokens ?? 0) +
            (finalUsage.reasoningTokens ?? 0)
        });

        write({
          type: "done",
          messageId: assistantMessage.id
        });
        controller.close();
      } catch (error) {
        updateAssistantMessage(assistantMessage.id, {
          content: "",
          thinkingContent: "",
          status: "error"
        });

        write({
          type: "error",
          message: error instanceof Error ? error.message : "Chat stream failed"
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

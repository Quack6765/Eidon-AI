import { z } from "zod";

import { resolveAssistantTurn } from "@/lib/assistant-runtime";
import { requireUser } from "@/lib/auth";
import {
  createMessageAction,
  createMessage,
  getConversation,
  maybeRetitleConversationFromFirstUserMessage,
  updateMessageAction,
  updateAssistantMessage
} from "@/lib/conversations";
import { ensureCompactedContext } from "@/lib/compaction";
import { badRequest } from "@/lib/http";
import {
  getSettings,
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";
import { encodeSseEvent } from "@/lib/sse";
import { estimateTextTokens } from "@/lib/tokenization";
import { listEnabledMcpServers } from "@/lib/mcp-servers";
import { listEnabledSkills } from "@/lib/skills";
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
  const user = await requireUser(false);

  if (!user) {
    return badRequest("Authentication required", 401);
  }
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

  const settings =
    (conversation.providerProfileId
      ? getProviderProfileWithApiKey(conversation.providerProfileId)
      : null) ?? getDefaultProviderProfileWithApiKey();
  const appSettings = getSettings();

  if (!settings?.apiKey) {
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
        const compacted = await ensureCompactedContext(conversation.id, settings);

        let promptMessages = compacted.promptMessages;
        const skills = appSettings.skillsEnabled ? listEnabledSkills() : [];

        const mcpServers = listEnabledMcpServers();
        let mcpToolSets: Array<{
          server: (typeof mcpServers)[number];
          tools: Awaited<ReturnType<typeof import("@/lib/mcp-client")["discoverMcpTools"]>>;
        }> = [];
        if (mcpServers.length) {
          const { gatherAllMcpTools, buildMcpToolsDescription } = await import("@/lib/mcp-client");
          mcpToolSets = await gatherAllMcpTools(mcpServers, conversation.toolExecutionMode);
          const description = buildMcpToolsDescription(mcpToolSets);
          if (description) {
            promptMessages = [
              ...promptMessages,
              {
                role: "system" as const,
                content: `MCP tools are available. When appropriate, respond with a tool call in this format:\n\nTOOL_CALL: {"serverId": "server_id", "tool": "tool_name", "arguments": {}}\n\nOnly emit TOOL_CALL when you want Hermes to execute a tool instead of answering normally.\n\nAvailable tools:\n\n${description}`
              }
            ];
          }
        }

        if (compacted.compactionNoticeEvent) {
          write(compacted.compactionNoticeEvent);
        }

        write({
          type: "message_start",
          messageId: assistantMessage.id
        });

        let actionSortOrder = 0;

        const providerResult = await resolveAssistantTurn({
          settings,
          promptMessages,
          skills,
          mcpToolSets,
          onEvent: write,
          onActionStart(action) {
            const persisted = createMessageAction({
              messageId: assistantMessage.id,
              kind: action.kind,
              label: action.label,
              detail: action.detail,
              serverId: action.serverId,
              skillId: action.skillId,
              toolName: action.toolName,
              arguments: action.arguments,
              sortOrder: actionSortOrder++
            });

            write({
              type: "action_start",
              action: persisted
            });

            return persisted.id;
          },
          onActionComplete(handle, patch) {
            if (!handle) {
              return;
            }

            const updated = updateMessageAction(handle, {
              status: "completed",
              detail: patch.detail,
              resultSummary: patch.resultSummary,
              completedAt: new Date().toISOString()
            });

            if (updated) {
              write({
                type: "action_complete",
                action: updated
              });
            }
          },
          onActionError(handle, patch) {
            if (!handle) {
              return;
            }

            const updated = updateMessageAction(handle, {
              status: "error",
              detail: patch.detail,
              resultSummary: patch.resultSummary,
              completedAt: new Date().toISOString()
            });

            if (updated) {
              write({
                type: "action_error",
                action: updated
              });
            }
          }
        });

        updateAssistantMessage(assistantMessage.id, {
          content: providerResult.answer,
          thinkingContent: providerResult.thinking,
          status: "completed",
          estimatedTokens:
            (providerResult.usage.inputTokens ?? 0) +
            (providerResult.usage.outputTokens ?? 0) +
            (providerResult.usage.reasoningTokens ?? 0)
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

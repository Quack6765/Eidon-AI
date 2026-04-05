import { resolveAssistantTurn } from "@/lib/assistant-runtime";
import {
  bindAttachmentsToMessage,
  createMessage,
  createMessageTextSegment,
  createMessageAction,
  generateConversationTitleFromFirstUserMessage,
  getConversation,
  setConversationActive,
  updateMessage,
  updateMessageAction
} from "@/lib/conversations";
import { ensureCompactedContext } from "@/lib/compaction";
import { estimateTextTokens } from "@/lib/tokenization";
import { listEnabledMcpServers } from "@/lib/mcp-servers";
import { listEnabledSkills } from "@/lib/skills";
import {
  getSettings,
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";
import { createEmitter } from "@/lib/emitter";
import type { ChatStreamEvent } from "@/lib/types";
import type { ConversationManager } from "@/lib/conversation-manager";

export type ChatEmitter = ReturnType<typeof createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>>;

const globalEmitter = createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>();

export function getChatEmitter(): ChatEmitter {
  return globalEmitter;
}

export async function startChatTurn(
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[]
) {
  const conversation = getConversation(conversationId);
  if (!conversation) return;

  const settings =
    (conversation.providerProfileId
      ? getProviderProfileWithApiKey(conversation.providerProfileId)
      : null) ?? getDefaultProviderProfileWithApiKey();
  const appSettings = getSettings();

  if (!settings?.apiKey) {
    manager.broadcast(conversationId, {
      type: "error",
      message: "Set an API key in settings before starting a chat"
    });
    return;
  }

  const userMessage = createMessage({
    conversationId: conversation.id,
    role: "user",
    content,
    estimatedTokens: estimateTextTokens(content)
  });

  bindAttachmentsToMessage(conversation.id, userMessage.id, attachmentIds);
  void generateConversationTitleFromFirstUserMessage(conversation.id, userMessage.id);

  const assistantMessage = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "streaming",
    estimatedTokens: 0
  });

  manager.broadcast(conversationId, {
    type: "delta",
    conversationId,
    event: { type: "message_start", messageId: assistantMessage.id }
  });

  manager.setActive(conversationId, true);
  globalEmitter.emit("status", conversationId, "streaming");
  setConversationActive(conversation.id, true);

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
      const { gatherAllMcpTools } = await import("@/lib/mcp-client");
      mcpToolSets = await gatherAllMcpTools(mcpServers, conversation.toolExecutionMode);
    }

    if (compacted.compactionNoticeEvent) {
      manager.broadcast(conversationId, {
        type: "delta",
        conversationId,
        event: compacted.compactionNoticeEvent
      });
    }

    let timelineSortOrder = 0;
    let answerBuffer = "";
    let sawStreamedAnswerSinceLastSegment = false;
    let lastFlush = Date.now();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushAnswerBuffer() {
      if (!answerBuffer) return;
      createMessageTextSegment({
        messageId: assistantMessage.id,
        content: answerBuffer,
        sortOrder: timelineSortOrder++
      });
      answerBuffer = "";
      lastFlush = Date.now();
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushAnswerBuffer();
      }, 100);
    }

    const providerResult = await resolveAssistantTurn({
      settings,
      promptMessages,
      skills,
      mcpServers,
      mcpToolSets,
      onEvent(event: ChatStreamEvent) {
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event
        });
        globalEmitter.emit("delta", conversationId, event);

        if (event.type === "answer_delta") {
          sawStreamedAnswerSinceLastSegment = true;
          answerBuffer += event.text;
          if (answerBuffer.length >= 500 || Date.now() - lastFlush >= 100) {
            flushAnswerBuffer();
          } else {
            scheduleFlush();
          }
        }
      },
      onAnswerSegment(segment) {
        flushAnswerBuffer();
        if (!sawStreamedAnswerSinceLastSegment && segment) {
          createMessageTextSegment({
            messageId: assistantMessage.id,
            content: segment,
            sortOrder: timelineSortOrder++
          });
        }
        sawStreamedAnswerSinceLastSegment = false;
      },
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
          sortOrder: timelineSortOrder++
        });
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event: { type: "action_start", action: persisted }
        });
        globalEmitter.emit("delta", conversationId, { type: "action_start", action: persisted });
        return persisted.id;
      },
      onActionComplete(handle, patch) {
        if (!handle) return;
        const updated = updateMessageAction(handle, {
          status: "completed",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          manager.broadcast(conversationId, {
            type: "delta",
            conversationId,
            event: { type: "action_complete", action: updated }
          });
          globalEmitter.emit("delta", conversationId, { type: "action_complete", action: updated });
        }
      },
      onActionError(handle, patch) {
        if (!handle) return;
        const updated = updateMessageAction(handle, {
          status: "error",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          manager.broadcast(conversationId, {
            type: "delta",
            conversationId,
            event: { type: "action_error", action: updated }
          });
          globalEmitter.emit("delta", conversationId, { type: "action_error", action: updated });
        }
      }
    });

    if (flushTimer) clearTimeout(flushTimer);
    flushAnswerBuffer();

    updateMessage(assistantMessage.id, {
      content: providerResult.answer,
      thinkingContent: providerResult.thinking,
      status: "completed",
      estimatedTokens:
        (providerResult.usage.inputTokens ?? 0) +
        (providerResult.usage.outputTokens ?? 0) +
        (providerResult.usage.reasoningTokens ?? 0)
    });

    manager.broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: { type: "done", messageId: assistantMessage.id }
    });
  } catch (error) {
    updateMessage(assistantMessage.id, {
      content: "",
      thinkingContent: "",
      status: "error"
    });
    manager.broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: {
        type: "error",
        message: error instanceof Error ? error.message : "Chat stream failed"
      }
    });
  } finally {
    setConversationActive(conversation.id, false);
    manager.setActive(conversationId, false);
    globalEmitter.emit("status", conversationId, "completed");
  }
}

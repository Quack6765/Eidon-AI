import type { Message, MessageActionKind, MessageTimelineItem } from "@/lib/types";

export const DELEGATION_MARKER_PATTERN = /^\[Message from (.+)\]$/;
export const AUTOMATED_DELIVERY_BLOCK_PATTERN = /\n---\n\(Automated delivery:[\s\S]*\)\s*$/;
export const DELEGATION_FAILURE_PREFIX = "The task failed";
const DELEGATE_LABEL_PATTERN = /^Messaged\s+(.+)$/;
const DELEGATION_DETAIL_PREFIX_PATTERN = /^→\s*[^:]+:\s*/;

export const DELEGATION_ACTION_KINDS = new Set<MessageActionKind>(["delegate_task", "message_bot"]);

export type DelegationAction = Extract<MessageTimelineItem, { timelineKind: "action" }>;

export function isDelegationActionKind(kind: MessageActionKind) {
  return DELEGATION_ACTION_KINDS.has(kind);
}

export function delegationActionBotName(action: Pick<DelegationAction, "label" | "arguments">) {
  const fromLabel = DELEGATE_LABEL_PATTERN.exec(action.label)?.[1]?.trim();
  if (fromLabel) {
    return fromLabel;
  }

  const fromArguments = action.arguments?.bot;
  return typeof fromArguments === "string" ? fromArguments.trim() : "";
}

export function delegationSentMessage(action: Pick<DelegationAction, "label" | "detail" | "arguments">) {
  const fromArguments = action.arguments?.message;
  if (typeof fromArguments === "string" && fromArguments.trim()) {
    return fromArguments.trim();
  }

  const legacyTaskPrompt = action.arguments?.task_prompt;
  if (typeof legacyTaskPrompt === "string" && legacyTaskPrompt.trim()) {
    return legacyTaskPrompt.trim();
  }

  const detail = action.detail?.trim();
  if (detail) {
    const stripped = detail.replace(DELEGATION_DETAIL_PREFIX_PATTERN, "").trim();
    if (stripped) {
      return stripped;
    }
  }

  return "";
}

export function parseDelegationWakeMessage(
  content: string
): { botName: string; content: string; failed: boolean } | null {
  if (!content.startsWith("[Message from ")) {
    return null;
  }

  const newlineIndex = content.indexOf("\n");
  const firstLine = (newlineIndex === -1 ? content : content.slice(0, newlineIndex)).trim();
  const match = DELEGATION_MARKER_PATTERN.exec(firstLine);

  if (!match || !match[1].trim()) {
    return null;
  }

  const payload = newlineIndex === -1 ? "" : content.slice(newlineIndex + 1);

  return {
    botName: match[1].trim(),
    content: payload.replace(AUTOMATED_DELIVERY_BLOCK_PATTERN, "").trim(),
    failed: payload.trimStart().startsWith(DELEGATION_FAILURE_PREFIX)
  };
}

export type DelegationReplyLink = {
  actionId: string;
  parentMessageId: string;
};

export type DelegationReplyIndex = {
  links: Map<string, DelegationReplyLink>;
  repliedActionIds: ReadonlySet<string>;
};

type DelegationTimelineMessage = Pick<Message, "id" | "role" | "content" | "timeline">;

export function matchDelegationReplies(
  messages: ReadonlyArray<DelegationTimelineMessage>
): DelegationReplyIndex {
  const queues = new Map<string, DelegationReplyLink[]>();
  const consumed = new Set<string>();
  const links = new Map<string, DelegationReplyLink>();

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const item of message.timeline ?? []) {
        if (item.timelineKind !== "action" || !isDelegationActionKind(item.kind)) {
          continue;
        }

        const botName = delegationActionBotName(item);
        if (!botName) {
          continue;
        }

        const queue = queues.get(botName);
        const link: DelegationReplyLink = {
          actionId: item.id,
          parentMessageId: item.messageId || message.id
        };

        if (queue) {
          queue.push(link);
        } else {
          queues.set(botName, [link]);
        }
      }

      continue;
    }

    if (message.role !== "user") {
      continue;
    }

    const wake = parseDelegationWakeMessage(message.content);
    if (!wake) {
      continue;
    }

    const queue = queues.get(wake.botName);
    const pending = queue?.find((candidate) => !consumed.has(candidate.actionId));
    if (pending) {
      consumed.add(pending.actionId);
      links.set(message.id, pending);
    }
  }

  return {
    links,
    repliedActionIds: new Set([...links.values()].map((link) => link.actionId))
  };
}

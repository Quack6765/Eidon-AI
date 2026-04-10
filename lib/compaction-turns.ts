import type { Message, MessageAction } from "@/lib/types";

export type CompletedTurn = {
  user: Message;
  assistant: Message;
};

export function isEmptyStreamingAssistantPlaceholder(
  message: Pick<Message, "role" | "content" | "thinkingContent" | "status">
) {
  return (
    message.role === "assistant" &&
    message.status === "streaming" &&
    !message.content.trim() &&
    !message.thinkingContent.trim()
  );
}

export function groupCompletedTurns(messages: Message[]): CompletedTurn[] {
  const turns: CompletedTurn[] = [];
  let pendingUser: Message | null = null;

  for (const message of messages) {
    if (message.role === "system" || message.compactedAt) {
      continue;
    }

    if (isEmptyStreamingAssistantPlaceholder(message)) {
      break;
    }

    if (message.role === "user") {
      pendingUser = message;
      continue;
    }

    if (!pendingUser) {
      continue;
    }

    turns.push({
      user: pendingUser,
      assistant: message
    });
    pendingUser = null;
  }

  return turns;
}

function renderActionOutcome(action: MessageAction) {
  const parts = [`[action] ${action.label}`];
  const summary = action.resultSummary.trim();

  if (summary) {
    parts.push(`result: ${summary}`);
  }

  return parts.join("\n");
}

export function renderCompletedTurn(turn: CompletedTurn) {
  const blocks: string[] = [];
  const userContent = turn.user.content.trim();
  const assistantContent = turn.assistant.content.trim();

  blocks.push([`[user] ${turn.user.id}`, userContent].filter(Boolean).join("\n"));

  const assistantBlocks = [`[assistant] ${turn.assistant.id}`];
  if (assistantContent) {
    assistantBlocks.push(assistantContent);
  }

  (turn.assistant.actions ?? []).forEach((action) => {
    assistantBlocks.push(renderActionOutcome(action));
  });

  if (assistantBlocks.length > 1) {
    blocks.push(assistantBlocks.join("\n\n"));
  }

  return blocks.join("\n\n");
}

export function renderCompletedTurns(messages: Message[]) {
  return groupCompletedTurns(messages)
    .map((turn) => renderCompletedTurn(turn))
    .filter(Boolean)
    .join("\n\n");
}

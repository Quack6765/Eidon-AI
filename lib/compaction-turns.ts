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
      continue;
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

function sanitizeResultSummary(summary: string) {
  const firstLine = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "";
  }

  const cleaned = firstLine
    .replace(/^[>*\-•\d.]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 240 ? `${cleaned.slice(0, 237).trimEnd()}...` : cleaned;
}

function renderActionOutcome(action: MessageAction) {
  const parts = [`[action] ${action.label}`];
  const summary = sanitizeResultSummary(action.resultSummary);

  if (summary) {
    parts.push(`result: ${summary}`);
  }

  return parts.join("\n");
}

function renderImageMentions(message: Message, label: string) {
  const images = (message.attachments ?? []).filter((attachment) => attachment.kind === "image");
  if (!images.length) {
    return null;
  }
  return `${label}: ${images.map((attachment) => attachment.filename).join(", ")}`;
}

export function renderCompletedTurn(turn: CompletedTurn) {
  const blocks: string[] = [];
  const userContent = turn.user.content.trim();
  const assistantContent = turn.assistant.content.trim();

  blocks.push(
    [`[user] ${turn.user.id}`, userContent, renderImageMentions(turn.user, "User attached images")]
      .filter(Boolean)
      .join("\n")
  );

  const assistantBlocks = [`[assistant] ${turn.assistant.id}`];
  if (assistantContent) {
    assistantBlocks.push(assistantContent);
  }

  (turn.assistant.actions ?? []).forEach((action) => {
    assistantBlocks.push(renderActionOutcome(action));
  });

  const generatedImages = renderImageMentions(
    turn.assistant,
    (turn.assistant.actions ?? []).some((action) => action.kind === "image_generation")
      ? "Generated images"
      : "Assistant attached images"
  );
  if (generatedImages) {
    assistantBlocks.push(generatedImages);
  }

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

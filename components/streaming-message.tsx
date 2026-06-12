"use client";

import { useSyncExternalStore } from "react";
import { MessageBubble } from "@/components/message-bubble";
import type { StreamBuffer } from "@/lib/stream-buffer";
import type {
  MemoryCategory,
  Message,
  MessageAttachment,
  MessageTimelineItem
} from "@/lib/types";

export function StreamingMessage({
  buffer,
  message,
  timeline,
  hasReceivedFirstToken,
  compactionInProgress,
  thinkingDuration,
  onPreviewAttachment,
  onUpdateUserMessage,
  onApproveMemoryProposal,
  onDismissMemoryProposal,
  onForkAssistantMessage,
  onRetryAssistantMessage
}: {
  buffer: StreamBuffer;
  message: Message;
  timeline: MessageTimelineItem[];
  hasReceivedFirstToken: boolean;
  compactionInProgress: boolean;
  thinkingDuration?: number;
  onPreviewAttachment?: (attachment: MessageAttachment) => void;
  onUpdateUserMessage?: (messageId: string, content: string) => Promise<void>;
  onApproveMemoryProposal?: (
    actionId: string,
    overrides?: { content?: string; category?: MemoryCategory }
  ) => Promise<void>;
  onDismissMemoryProposal?: (actionId: string) => Promise<void>;
  onForkAssistantMessage?: (messageId: string) => void;
  onRetryAssistantMessage?: (messageId: string) => void;
}) {
  const snapshot = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot, buffer.getSnapshot);
  const hasRunningStreamingAction = timeline.some(
    (item) => item.timelineKind === "action" && item.status === "running"
  );
  const awaitingFirstToken =
    !hasReceivedFirstToken &&
    !snapshot.answerDisplay &&
    !message.content &&
    timeline.length === 0;

  return (
    <MessageBubble
      message={message}
      streamingTimeline={timeline}
      streamingThinking={snapshot.thinkingDisplay}
      streamingAnswer={snapshot.answerDisplay}
      awaitingFirstToken={awaitingFirstToken}
      compactionInProgress={compactionInProgress}
      thinkingInProgress={
        Boolean(snapshot.thinkingTarget) && !snapshot.answerTarget && !hasRunningStreamingAction
      }
      thinkingDuration={thinkingDuration}
      hasThinking={Boolean(snapshot.thinkingTarget)}
      onPreviewAttachment={onPreviewAttachment}
      onUpdateUserMessage={onUpdateUserMessage}
      onApproveMemoryProposal={onApproveMemoryProposal}
      onDismissMemoryProposal={onDismissMemoryProposal}
      onForkAssistantMessage={onForkAssistantMessage}
      onRetryAssistantMessage={onRetryAssistantMessage}
    />
  );
}

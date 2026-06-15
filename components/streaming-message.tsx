"use client";

import React, { useSyncExternalStore } from "react";
import { MessageBubble } from "@/components/message-bubble";
import type { StreamBuffer, StreamBufferSnapshot } from "@/lib/stream-buffer";
import type {
  MemoryCategory,
  Message,
  MessageAttachment,
  MessageTimelineItem
} from "@/lib/types";

const INACTIVE_SNAPSHOT: StreamBufferSnapshot = Object.freeze({
  answerTarget: "",
  answerDisplay: "",
  thinkingTarget: "",
  thinkingDisplay: ""
});

const noopSubscribe = () => () => {};
const getInactiveSnapshot = () => INACTIVE_SNAPSHOT;

function StreamingMessageImpl({
  active,
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
  onRetryAssistantMessage,
  onRegenerateUserMessage,
  isUpdating,
  isForking,
  isRetrying,
  isRegenerating
}: {
  active: boolean;
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
  onRegenerateUserMessage?: (messageId: string) => void;
  isUpdating?: boolean;
  isForking?: boolean;
  isRetrying?: boolean;
  isRegenerating?: boolean;
}) {
  const snapshot = useSyncExternalStore(
    active ? buffer.subscribe : noopSubscribe,
    active ? buffer.getSnapshot : getInactiveSnapshot,
    active ? buffer.getSnapshot : getInactiveSnapshot
  );
  const hasRunningStreamingAction =
    active &&
    timeline.some((item) => item.timelineKind === "action" && item.status === "running");
  const awaitingFirstToken =
    active &&
    !hasReceivedFirstToken &&
    !snapshot.answerDisplay &&
    !message.content &&
    timeline.length === 0;

  return (
    <MessageBubble
      message={message}
      streamingTimeline={active ? timeline : undefined}
      streamingThinking={active ? snapshot.thinkingDisplay : undefined}
      streamingAnswer={active ? snapshot.answerDisplay : undefined}
      awaitingFirstToken={awaitingFirstToken}
      compactionInProgress={active ? compactionInProgress : false}
      thinkingInProgress={
        active && Boolean(snapshot.thinkingTarget) && !snapshot.answerTarget && !hasRunningStreamingAction
      }
      thinkingDuration={active ? thinkingDuration : undefined}
      hasThinking={active && Boolean(snapshot.thinkingTarget)}
      onPreviewAttachment={onPreviewAttachment}
      onUpdateUserMessage={onUpdateUserMessage}
      onApproveMemoryProposal={onApproveMemoryProposal}
      onDismissMemoryProposal={onDismissMemoryProposal}
      onForkAssistantMessage={onForkAssistantMessage}
      onRetryAssistantMessage={onRetryAssistantMessage}
      onRegenerateUserMessage={onRegenerateUserMessage}
      isUpdating={isUpdating}
      isForking={isForking}
      isRetrying={isRetrying}
      isRegenerating={isRegenerating}
    />
  );
}

export const StreamingMessage = React.memo(StreamingMessageImpl);

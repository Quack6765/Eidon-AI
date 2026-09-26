"use client";

import React, { useSyncExternalStore } from "react";
import { MessageBubble } from "@/components/message-bubble";
import type { AutomationProposalOverrides } from "@/lib/automation-proposals";
import type { ReferenceCandidate } from "@/lib/reference-tokens";
import type { StreamBuffer, StreamBufferSnapshot } from "@/lib/stream-buffer";
import type {
  MemoryCategory,
  Message,
  MessageTimelineItem,
  PublicMessageAttachment,
  ToolCallDisplayMode
} from "@/lib/types";

const INACTIVE_SNAPSHOT: StreamBufferSnapshot = Object.freeze({
  answerTarget: "",
  answerDisplay: "",
  thinkingTarget: "",
  thinkingDisplay: "",
  isSettled: true
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
  confirmExternalLinks,
  toolCallDisplay,
  onPreviewAttachment,
  onUpdateUserMessage,
  onApproveMemoryProposal,
  onDismissMemoryProposal,
  onApproveAutomationProposal,
  onDismissAutomationProposal,
  onApproveToolApproval,
  onDismissToolApproval,
  onSendMessageDraft,
  onDiscardMessageDraft,
  onForkMessage,
  onRewindMessage,
  onRetryAssistantMessage,
  onRegenerateUserMessage,
  isUpdating,
  isForking,
  isRetrying,
  isRegenerating,
  referenceCandidates,
  computerConversationId
}: {
  active: boolean;
  buffer: StreamBuffer;
  message: Message;
  timeline: MessageTimelineItem[];
  hasReceivedFirstToken: boolean;
  compactionInProgress: boolean;
  thinkingDuration?: number;
  confirmExternalLinks: boolean;
  toolCallDisplay: ToolCallDisplayMode;
  onPreviewAttachment?: (attachment: PublicMessageAttachment) => void;
  onUpdateUserMessage?: (messageId: string, content: string) => Promise<void>;
  onApproveMemoryProposal?: (
    actionId: string,
    overrides?: { content?: string; category?: MemoryCategory }
  ) => Promise<void>;
  onDismissMemoryProposal?: (actionId: string) => Promise<void>;
  onApproveAutomationProposal?: (
    actionId: string,
    overrides?: AutomationProposalOverrides
  ) => Promise<void>;
  onDismissAutomationProposal?: (actionId: string) => Promise<void>;
  onApproveToolApproval?: (
    actionId: string,
    options?: { allowAlways?: boolean }
  ) => Promise<void>;
  onDismissToolApproval?: (actionId: string) => Promise<void>;
  onSendMessageDraft?: (actionId: string, fields?: Record<string, string>) => Promise<void>;
  onDiscardMessageDraft?: (actionId: string) => Promise<void>;
  onForkMessage?: (messageId: string) => void;
  onRewindMessage?: (messageId: string) => void;
  onRetryAssistantMessage?: (messageId: string) => void;
  onRegenerateUserMessage?: (messageId: string) => void;
  isUpdating?: boolean;
  isForking?: boolean;
  isRetrying?: boolean;
  isRegenerating?: boolean;
  referenceCandidates?: ReferenceCandidate[];
  computerConversationId?: string;
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
      confirmExternalLinks={confirmExternalLinks}
      toolCallDisplay={toolCallDisplay}
      hasThinking={active && Boolean(snapshot.thinkingTarget)}
      onPreviewAttachment={onPreviewAttachment}
      onUpdateUserMessage={onUpdateUserMessage}
      onApproveMemoryProposal={onApproveMemoryProposal}
      onDismissMemoryProposal={onDismissMemoryProposal}
      onApproveAutomationProposal={onApproveAutomationProposal}
      onDismissAutomationProposal={onDismissAutomationProposal}
      onApproveToolApproval={onApproveToolApproval}
      onDismissToolApproval={onDismissToolApproval}
      onSendMessageDraft={onSendMessageDraft}
      onDiscardMessageDraft={onDiscardMessageDraft}
      onForkMessage={onForkMessage}
      onRewindMessage={onRewindMessage}
      onRetryAssistantMessage={onRetryAssistantMessage}
      onRegenerateUserMessage={onRegenerateUserMessage}
      isUpdating={isUpdating}
      isForking={isForking}
      isRetrying={isRetrying}
      isRegenerating={isRegenerating}
      referenceCandidates={referenceCandidates}
      computerConversationId={computerConversationId}
      computerLive={active}
    />
  );
}

export const StreamingMessage = React.memo(StreamingMessageImpl);

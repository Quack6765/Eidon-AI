"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AttachmentPreviewModal,
  useAttachmentPreviewController
} from "@/components/attachment-preview-modal";
import { ChatComposer } from "@/components/chat-composer";
import { QueuedMessageBanner } from "@/components/queued-message-banner";
import { MessageBubble } from "@/components/message-bubble";
import { clearChatBootstrap, readChatBootstrap } from "@/lib/chat-bootstrap";
import { useContextTokens } from "@/lib/context-tokens-context";
import {
  dispatchConversationActivityUpdated,
  dispatchConversationTitleUpdated
} from "@/lib/conversation-events";
import { useWebSocket } from "@/lib/ws-client";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { appendTranscriptToDraft } from "@/lib/speech/append-transcript-to-draft";
import { useSpeechInput } from "@/lib/speech/use-speech-input";
import { cn, shouldAutofocusTextInput } from "@/lib/utils";
import type { AppSettings } from "@/lib/types";
import type {
  ChatStreamEvent,
  Conversation,
  MemoryCategory,
  Message,
  MessageAction,
  MessageAttachment,
  MessageTimelineItem,
  QueuedMessage,
  ProviderProfileSummary
} from "@/lib/types";

type ConversationPayload = {
  conversation: Conversation;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  settings: Pick<AppSettings, "sttEngine" | "sttLanguage">;
  providerProfiles: ProviderProfileSummary[];
  defaultProviderProfileId: string | null;
  debug: {
    rawTurnCount: number;
    memoryNodeCount: number;
    latestCompactionAt: string | null;
  };
};

const AUTO_SCROLL_THRESHOLD_PX = 32;

type SnapshotReconciliation = {
  messages: Message[];
  pendingLocalSubmissions: PendingLocalSubmission[];
};

type PendingLocalSubmission = {
  localMessageId: string;
  content: string;
  attachments: MessageAttachment[];
  serverMessageId: string | null;
};

function getActionSignature(action: Pick<MessageAction, "kind" | "label" | "detail" | "toolName">) {
  return [action.kind, action.label, action.detail, action.toolName ?? ""].join("\u0000");
}

function isNearQueueBottom(element: HTMLDivElement) {
  const distanceFromBottom =
    element.scrollHeight - element.clientHeight - element.scrollTop;
  return distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
}

function getAttachmentIdSignature(attachments: MessageAttachment[] | undefined) {
  return [...(attachments ?? []).map((attachment) => attachment.id)].sort().join("\u0000");
}

function matchesPendingLocalSubmission(
  message: Message,
  submission: PendingLocalSubmission
) {
  return (
    message.role === "user" &&
    message.content === submission.content &&
    getAttachmentIdSignature(message.attachments) ===
      getAttachmentIdSignature(submission.attachments)
  );
}

function attachmentsAreSubset(
  candidateAttachments: MessageAttachment[] | undefined,
  submissionAttachments: MessageAttachment[]
) {
  const submissionAttachmentIds = new Set(submissionAttachments.map((attachment) => attachment.id));
  return (candidateAttachments ?? []).every((attachment) =>
    submissionAttachmentIds.has(attachment.id)
  );
}

function findMatchingActionIndex(timeline: MessageTimelineItem[], action: MessageAction) {
  const signature = getActionSignature(action);

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];

    if (item.timelineKind === "action" && getActionSignature(item) === signature) {
      return index;
    }
  }

  return -1;
}

function appendStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  const existingIndex = timeline.findIndex(
    (item) => item.timelineKind === "action" && item.id === action.id
  );

  if (existingIndex !== -1) {
    return timeline.map((item, index) =>
      index === existingIndex ? { ...action, timelineKind: "action" } : item
    );
  }

  const matchingIndex = findMatchingActionIndex(timeline, action);

  if (matchingIndex !== -1) {
    return timeline.map((item, index) =>
      index === matchingIndex ? { ...action, timelineKind: "action" } : item
    );
  }

  return [...timeline, { ...action, timelineKind: "action" }];
}

function updateStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  let found = false;
  const nextTimeline = timeline.map((item): MessageTimelineItem => {
    if (item.timelineKind === "action" && item.id === action.id) {
      found = true;
      return { ...action, timelineKind: "action" };
    }

    return item;
  });

  if (found) {
    return nextTimeline;
  }

  const matchingIndex = findMatchingActionIndex(timeline, action);

  if (matchingIndex !== -1) {
    return timeline.map((item, index) =>
      index === matchingIndex ? { ...action, timelineKind: "action" } : item
    );
  }

  return [...timeline, { ...action, timelineKind: "action" }];
}

function isLegacyCompactionNotice(message: Pick<Message, "role" | "systemKind">) {
  return message.role === "system" && message.systemKind === "compaction_notice";
}

function sanitizeMessages(messages: Message[] | undefined) {
  if (!messages) return [];
  return messages.filter((message) => !isLegacyCompactionNotice(message));
}

function reconcileSnapshotMessages(
  current: Message[],
  snapshot: Message[] | undefined,
  activeStreamMessageId: string | null,
  pendingLocalSubmissions: PendingLocalSubmission[]
): SnapshotReconciliation {
  const sanitizedSnapshot = sanitizeMessages(snapshot);
  if (sanitizedSnapshot.length === 0) {
    return {
      messages: current.filter((message) => !isLegacyCompactionNotice(message)),
      pendingLocalSubmissions
    };
  }

  const merged = sanitizedSnapshot.map((snapshotMsg) => {
    const currentMsg = current.find((m) => m.id === snapshotMsg.id);

    if (currentMsg && currentMsg.id === activeStreamMessageId) {
      return currentMsg;
    }

    if (currentMsg && currentMsg.status === "completed" && snapshotMsg.status === "streaming") {
      return currentMsg;
    }

    return snapshotMsg;
  });

  const snapshotMessageIds = new Set(sanitizedSnapshot.map((m) => m.id));
  const currentNonLocalIds = new Set(
    current.filter((m) => !m.id.startsWith("local_")).map((m) => m.id)
  );
  const confirmedLocalIds = new Set<string>();
  const claimedServerUserMessageIds = new Set<string>();
  const newServerUserMessages = sanitizedSnapshot.filter(
    (message) => message.role === "user" && !currentNonLocalIds.has(message.id)
  );
  const nextPendingLocalSubmissions = pendingLocalSubmissions.map((submission) => ({
    ...submission
  }));

  for (const submission of nextPendingLocalSubmissions) {
    if (
      submission.serverMessageId &&
      !sanitizedSnapshot.some((message) => message.id === submission.serverMessageId)
    ) {
      submission.serverMessageId = null;
    }

    const candidateServerUserMessages =
      submission.serverMessageId !== null
        ? sanitizedSnapshot.filter((message) => message.id === submission.serverMessageId)
        : newServerUserMessages.filter((message) => !claimedServerUserMessageIds.has(message.id));

    const matchedServerMessage = candidateServerUserMessages.find(
      (message) => matchesPendingLocalSubmission(message, submission)
    );

    if (!matchedServerMessage) {
      if (submission.attachments.length === 0 || submission.serverMessageId !== null) {
        continue;
      }

      const partialServerMessage = newServerUserMessages.find(
        (message) =>
          !claimedServerUserMessageIds.has(message.id) &&
          message.role === "user" &&
          message.content === submission.content &&
          attachmentsAreSubset(message.attachments, submission.attachments)
      );

      if (partialServerMessage) {
        submission.serverMessageId = partialServerMessage.id;
        claimedServerUserMessageIds.add(partialServerMessage.id);
      }

      continue;
    }

    submission.serverMessageId = matchedServerMessage.id;
    confirmedLocalIds.add(submission.localMessageId);
    claimedServerUserMessageIds.add(matchedServerMessage.id);
  }

  const pendingLocalMessages = current.filter((m) => {
    if (snapshotMessageIds.has(m.id)) {
      return false;
    }

    if (confirmedLocalIds.has(m.id)) {
      return false;
    }

    return !isLegacyCompactionNotice(m);
  });

  return {
    messages: [...merged, ...pendingLocalMessages],
    pendingLocalSubmissions: nextPendingLocalSubmissions.filter(
      (submission) => !confirmedLocalIds.has(submission.localMessageId)
    )
  };
}

function adoptStreamingSnapshotState(timeline: MessageTimelineItem[] | undefined) {
  const consolidated: MessageTimelineItem[] = [];
  let textBuffer = "";
  let textCreatedAt: string | null = null;

  function flushBufferedText() {
    if (!textBuffer || !textCreatedAt) {
      return;
    }

    consolidated.push({
      id: `adopted_text_${consolidated.length}`,
      timelineKind: "text",
      sortOrder: consolidated.length,
      createdAt: textCreatedAt,
      content: textBuffer
    });
    textBuffer = "";
    textCreatedAt = null;
  }

  for (const item of timeline ?? []) {
    if (item.timelineKind === "text") {
      textBuffer += item.content;
      textCreatedAt ??= item.createdAt;
      continue;
    }

    flushBufferedText();
    consolidated.push({
      ...item,
      timelineKind: "action",
      sortOrder: consolidated.length
    });
  }

  flushBufferedText();

  const answer = consolidated
    .filter((item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> => item.timelineKind === "text")
    .map((item) => item.content)
    .join("");

  const lastItem = consolidated.at(-1);
  const closedTimeline = lastItem?.timelineKind === "text" ? consolidated.slice(0, -1) : consolidated;

  return {
    answer,
    timeline: closedTimeline
  };
}

function replaceMessageAction(
  messages: Message[],
  nextAction: MessageAction
) {
  return messages.map((message) => {
    const nextActions = message.actions?.map((action) =>
      action.id === nextAction.id ? nextAction : action
    );
    const nextTimeline = message.timeline?.map((item) =>
      item.timelineKind === "action" && item.id === nextAction.id
        ? { ...nextAction, timelineKind: "action" as const }
        : item
    );

    if (nextActions === message.actions && nextTimeline === message.timeline) {
      return message;
    }

    return {
      ...message,
      ...(nextActions ? { actions: nextActions } : {}),
      ...(nextTimeline ? { timeline: nextTimeline } : {})
    };
  });
}

function isQueuedMessageOperationError(message: string) {
  return message === "Queued message not found";
}

export function ChatView({ payload }: { payload: ConversationPayload }) {
  const router = useRouter();
  const { getTokenUsage, setTokenUsage } = useContextTokens();
  const previewController = useAttachmentPreviewController();
  const activeConversationIdRef = useRef(payload.conversation.id);
  const [messages, setMessages] = useState(() => sanitizeMessages(payload.messages));
  const [queuedMessages, setQueuedMessages] = useState(() => payload.queuedMessages);
  const [conversationTitle, setConversationTitle] = useState(payload.conversation.title);
  const [titleGenerationStatus, setTitleGenerationStatus] = useState(
    payload.conversation.titleGenerationStatus
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isStopPending, setIsStopPending] = useState(false);
  const [streamThinkingTarget, setStreamThinkingTarget] = useState("");
  const [streamThinkingDisplay, setStreamThinkingDisplay] = useState("");
  const [streamAnswerTarget, setStreamAnswerTarget] = useState("");
  const [streamAnswerDisplay, setStreamAnswerDisplay] = useState("");
  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const [streamTimeline, setStreamTimeline] = useState<MessageTimelineItem[]>([]);
  const [hasReceivedFirstToken, setHasReceivedFirstToken] = useState(false);
  const [compactionInProgress, setCompactionInProgress] = useState(false);
  const [usedTokens, setUsedTokens] = useState<number | null>(null);
  const [isConversationActive, setIsConversationActive] = useState(payload.conversation.isActive);
  const hasInitializedTokensRef = useRef(false);

  useEffect(() => {
    if (!hasInitializedTokensRef.current) {
      hasInitializedTokensRef.current = true;
      const tokens = getTokenUsage(payload.conversation.id);
      if (tokens !== null) {
        setUsedTokens(tokens);
      }
    }
  }, [payload.conversation.id, getTokenUsage]);

  useEffect(() => {
    if (activeConversationIdRef.current === payload.conversation.id) {
      return;
    }

    activeConversationIdRef.current = payload.conversation.id;
    previewController.closeAttachmentPreview();
  }, [payload.conversation.id, previewController.closeAttachmentPreview]);

  const compactionInProgressRef = useRef(false);
  const thinkingStartTimeRef = useRef<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number | undefined>(undefined);
  const [providerProfileId, setProviderProfileId] = useState(
    payload.conversation.providerProfileId ??
      payload.defaultProviderProfileId ??
      payload.providerProfiles[0]?.id ??
      ""
  );
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [personas, setPersonas] = useState<Array<{ id: string; name: string }>>([]);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [isConversationAtBottom, setIsConversationAtBottom] = useState(true);
  const queueBannerRef = useRef<HTMLDivElement>(null);
  const [queueBannerHeight, setQueueBannerHeight] = useState(0);

  const {
    speechSnapshot,
    startSpeech,
    stopSpeech
  } = useSpeechInput({
    engine: payload.settings.sttEngine,
    initialLanguage: payload.settings.sttLanguage,
    resetKey: payload.conversation.id
  });
  const hasEmptyAssistantShell = messages.some(
    (message) =>
      message.role === "assistant" &&
      !message.content &&
      !(message.timeline?.length ?? 0) &&
      (message.status === "streaming" || message.status === "completed")
  );
  const queueRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);
  const messagesRef = useRef(payload.messages);
  const streamAnswerTargetRef = useRef("");
  const streamThinkingTargetRef = useRef("");
  const streamMessageIdRef = useRef<string | null>(null);
  const streamTimelineRef = useRef<MessageTimelineItem[]>([]);
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const titlePollTimeoutRef = useRef<number | null>(null);
  const titlePollAttemptsRef = useRef(0);
  const messageSyncTimeoutRef = useRef<number | null>(null);
  const pendingLocalSubmissionsRef = useRef<PendingLocalSubmission[]>([]);

  const shouldAutoScrollRef = useRef(true);
  const bootstrapPayloadRef = useRef<{
    message: string;
    attachments: MessageAttachment[];
    personaId?: string;
  } | null>(null);
  const bootstrapSubmittedRef = useRef(false);
  const submitRef = useRef<
    (nextInput?: string, nextPendingAttachments?: MessageAttachment[], nextPersonaId?: string) => Promise<void>
  >(async () => {});
  const pendingLocalSubmissionsById = new Map(
    pendingLocalSubmissionsRef.current.map((submission) => [
      submission.localMessageId,
      submission
    ] as const)
  );
  const renderableMessages = messages.filter(
    (message) => {
      if (!message.id.startsWith("local_")) {
        return true;
      }

      const pendingSubmission = pendingLocalSubmissionsById.get(message.id);

      if (pendingSubmission) {
        return pendingSubmission.serverMessageId === null;
      }

      if (message.role !== "user") {
        return true;
      }

      return !messages.some(
        (candidate) =>
          !candidate.id.startsWith("local_") &&
          candidate.role === "user" &&
          candidate.content === message.content &&
          getAttachmentIdSignature(candidate.attachments) ===
            getAttachmentIdSignature(message.attachments)
      );
    }
  );
  const hasPendingLocalSubmission = pendingLocalSubmissionsRef.current.length > 0;
  const hasOptimisticLocalMessage = renderableMessages.some((message) =>
    message.id.startsWith("local_")
  );
  const needsMessageSync =
    isSending ||
    hasPendingLocalSubmission ||
    streamMessageId !== null ||
    messages.some((message) => message.role === "assistant" && message.status === "streaming") ||
    hasEmptyAssistantShell;

  function updateStreamTimeline(
    nextTimeline:
      | MessageTimelineItem[]
      | ((previous: MessageTimelineItem[]) => MessageTimelineItem[])
  ) {
    const resolvedTimeline =
      typeof nextTimeline === "function"
        ? nextTimeline(streamTimelineRef.current)
        : nextTimeline;
    streamTimelineRef.current = resolvedTimeline;
    setStreamTimeline(resolvedTimeline);
  }

  useEffect(() => {
    setMessages(sanitizeMessages(payload.messages));
  }, [payload.messages]);

  useEffect(() => {
    setQueuedMessages(payload.queuedMessages);
  }, [payload.queuedMessages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    streamMessageIdRef.current = streamMessageId;
  }, [streamMessageId]);

  useEffect(() => {
    streamTimelineRef.current = streamTimeline;
  }, [streamTimeline]);

  useEffect(() => {
    compactionInProgressRef.current = compactionInProgress;
  }, [compactionInProgress]);

  function clearCompactionIndicator() {
    if (compactionInProgressRef.current) {
      setCompactionInProgress(false);
    }
  }

  function resetStreamingState() {
    clearCompactionIndicator();
    setStreamMessageId(null);
    updateStreamTimeline([]);
    setStreamThinkingTarget("");
    setStreamThinkingDisplay("");
    setStreamAnswerTarget("");
    setStreamAnswerDisplay("");
    streamAnswerTargetRef.current = "";
    streamThinkingTargetRef.current = "";
    setHasReceivedFirstToken(false);
    thinkingStartTimeRef.current = null;
    setThinkingDuration(undefined);
    setIsStopPending(false);
  }

  useEffect(() => {
    setConversationTitle(payload.conversation.title);
  }, [payload.conversation.title]);

  useEffect(() => {
    setIsConversationActive(payload.conversation.isActive);
  }, [payload.conversation.isActive]);

  useEffect(() => {
    setTitleGenerationStatus(payload.conversation.titleGenerationStatus);
  }, [payload.conversation.titleGenerationStatus]);

  useEffect(() => {
    setProviderProfileId(
      payload.conversation.providerProfileId ??
        payload.defaultProviderProfileId ??
        payload.providerProfiles[0]?.id ??
        ""
    );
  }, [payload.conversation.providerProfileId, payload.defaultProviderProfileId, payload.providerProfiles]);

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((d) => {
        if (d.personas) setPersonas(d.personas);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    requestAnimationFrame(() => {
      if (!queueRef.current) {
        return;
      }

      setIsConversationAtBottom(isNearQueueBottom(queueRef.current));
    });
  }, [payload.conversation.id]);

  function jumpToBottom() {
    if (!queueRef.current) {
      return;
    }

    shouldAutoScrollRef.current = true;
    setIsConversationAtBottom(true);
    queueRef.current.scrollTo({ top: queueRef.current.scrollHeight, behavior: "smooth" });
  }

  useEffect(() => {
    const el = queueBannerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setQueueBannerHeight(el.offsetHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!queueRef.current || !shouldAutoScrollRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      if (!queueRef.current || !shouldAutoScrollRef.current) return;
      setIsConversationAtBottom(true);
      if (queueRef.current.scrollTo) {
        queueRef.current.scrollTo({ top: queueRef.current.scrollHeight, behavior: "instant" });
      } else {
        queueRef.current.scrollTop = queueRef.current.scrollHeight;
      }
    });
  }, [messages, streamThinkingDisplay, streamAnswerDisplay, streamTimeline]);

  useEffect(() => {
    if (!shouldAutofocusTextInput()) {
      return;
    }

    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      const length = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(length, length);
    });

    return () => window.cancelAnimationFrame(handle);
  }, [payload.conversation.id]);

  function handleDelta(event: ChatStreamEvent) {
    if (event.type === "compaction_start") {
      setCompactionInProgress(true);
      return;
    }

    if (event.type === "compaction_end") {
      setCompactionInProgress(false);
      return;
    }

    if (event.type === "message_start") {
      setIsConversationActive(true);
      setStreamMessageId(event.messageId);
      dispatchConversationActivityUpdated({
        conversationId: payload.conversation.id,
        isActive: true
      });
      setMessages((current) => {
        if (current.some((message) => message.id === event.messageId)) {
          return current;
        }

        return [
          ...current,
          {
            id: event.messageId,
            conversationId: payload.conversation.id,
            role: "assistant",
            content: "",
            thinkingContent: "",
            status: "streaming",
            estimatedTokens: 0,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString()
          }
        ];
      });
      return;
    }

    if (event.type === "usage") {
      if (event.inputTokens !== undefined) {
        console.log(`[ChatView] Usage event received for ${payload.conversation.id}: ${event.inputTokens} tokens`);
        setUsedTokens(event.inputTokens);
        setTokenUsage(payload.conversation.id, event.inputTokens);
      }
      return;
    }

    if (event.type === "thinking_delta") {
      clearCompactionIndicator();
      setHasReceivedFirstToken(true);
      const nextThinking = `${streamThinkingTargetRef.current}${event.text}`;
      streamThinkingTargetRef.current = nextThinking;
      setStreamThinkingTarget(nextThinking);
      if (!thinkingStartTimeRef.current) {
        thinkingStartTimeRef.current = Date.now();
      }
    }

    if (event.type === "answer_delta") {
      clearCompactionIndicator();
      setHasReceivedFirstToken(true);
      const nextAnswer = `${streamAnswerTargetRef.current}${event.text}`;
      streamAnswerTargetRef.current = nextAnswer;
      setStreamAnswerTarget(nextAnswer);
      if (thinkingStartTimeRef.current && !thinkingDuration) {
        const duration = (Date.now() - thinkingStartTimeRef.current) / 1000;
        setThinkingDuration(duration);
      }
    }

    if (event.type === "system_notice") {
      setMessages((current) => [
        ...current,
        {
          id: `ws_notice_${Date.now()}`,
          conversationId: payload.conversation.id,
          role: "system",
          content: event.text,
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 0,
          systemKind: event.kind,
          compactedAt: null,
          createdAt: new Date().toISOString()
        }
      ]);
    }

    if (event.type === "action_start") {
      clearCompactionIndicator();
      updateStreamTimeline((prev) => {
        const isExisting = prev.some((item) => item.timelineKind === "action" && item.id === event.action.id);
        if (isExisting) {
          return appendStreamingAction(prev, event.action);
        }

        const previousTextLen = prev
          .filter((item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> => item.timelineKind === "text")
          .reduce((sum, item) => sum + item.content.length, 0);

        const newText = streamAnswerTargetRef.current.slice(previousTextLen);
        const nextTimeline = [...prev];

        if (newText.length > 0) {
          nextTimeline.push({
            id: `stream_text_${Date.now()}_${prev.length}`,
            timelineKind: "text",
            sortOrder: prev.length,
            createdAt: new Date().toISOString(),
            content: newText
          });
        }

        return appendStreamingAction(nextTimeline, event.action);
      });
    }

    if (event.type === "action_complete" || event.type === "action_error") {
      clearCompactionIndicator();
      updateStreamTimeline((prev) => updateStreamingAction(prev, event.action));
    }

    if (event.type === "done") {
      clearCompactionIndicator();
      setIsConversationActive(false);
      const wasStopped = isStopPending;
      setIsStopPending(false);
      const finalAnswer = streamAnswerTargetRef.current;
      const finalThinking = streamThinkingTargetRef.current;
      const finalTimeline = streamTimelineRef.current;
      dispatchConversationActivityUpdated({
        conversationId: payload.conversation.id,
        isActive: false
      });

      setMessages((current) =>
        current.map((m) =>
          m.id === event.messageId
            ? {
                ...m,
                content: finalAnswer,
                thinkingContent: finalThinking,
                status: wasStopped ? ("stopped" as const) : ("completed" as const),
                timeline: finalTimeline
              }
            : m
        )
      );
      setStreamMessageId(null);
      updateStreamTimeline([]);
      setStreamAnswerTarget("");
      setStreamAnswerDisplay("");
      setStreamThinkingTarget("");
      setStreamThinkingDisplay("");
      streamAnswerTargetRef.current = "";
      streamThinkingTargetRef.current = "";
      setIsSending(false);
    }

    if (event.type === "error") {
      clearCompactionIndicator();
      setIsConversationActive(false);
      setIsStopPending(false);
      const activeStreamMessageId = streamMessageIdRef.current;
      dispatchConversationActivityUpdated({
        conversationId: payload.conversation.id,
        isActive: false
      });
      setMessages((current) =>
        current.map((m) =>
          m.id === activeStreamMessageId ? { ...m, status: "error" as const } : m
        )
      );
      setError(event.message);
      setStreamMessageId(null);
      updateStreamTimeline([]);
      setIsSending(false);
    }
  }

  const {
    send: wsSend,
    subscribe: wsSubscribe,
    unsubscribe: wsUnsubscribe,
    connected: wsConnected,
    failed: wsFailed
  } = useWebSocket({
    onMessage(msg) {
      switch (msg.type) {
        case "ready":
          setIsConversationActive(
            msg.activeConversations.some(
              (conversation) =>
                conversation.id === payload.conversation.id &&
                conversation.status === "streaming"
            )
          );
          dispatchConversationActivityUpdated({
            conversationId: payload.conversation.id,
            isActive: msg.activeConversations.some(
              (conversation) =>
                conversation.id === payload.conversation.id &&
                conversation.status === "streaming"
            )
          });
          break;
        case "snapshot":
          setQueuedMessages((msg.queuedMessages as QueuedMessage[] | undefined) ?? []);
          setIsConversationActive(
            (msg.messages as Message[]).some(
              (message) => message.role === "assistant" && message.status === "streaming"
            )
          );
          if (streamMessageId) {
            const activeSnapshotMessage = (msg.messages as Message[]).find(
              (message) => message.id === streamMessageId
            );

            if (activeSnapshotMessage && activeSnapshotMessage.status !== "streaming") {
              setStreamMessageId(null);
              updateStreamTimeline([]);
              setStreamAnswerTarget("");
              setStreamAnswerDisplay("");
              setStreamThinkingTarget("");
              setStreamThinkingDisplay("");
              streamAnswerTargetRef.current = "";
              streamThinkingTargetRef.current = "";
              setHasReceivedFirstToken(false);
              setIsSending(false);
            }
          } else {
            const streamingMsg = (msg.messages as Message[]).find(
              (message) => message.status === "streaming" && message.role === "assistant"
            );
            if (streamingMsg) {
              const adoptedStream = adoptStreamingSnapshotState(streamingMsg.timeline);
              const answerFromTimeline = adoptedStream.answer;
              setStreamMessageId(streamingMsg.id);
              streamAnswerTargetRef.current = answerFromTimeline;
              streamThinkingTargetRef.current = streamingMsg.thinkingContent ?? "";
              setStreamAnswerTarget(answerFromTimeline);
              setStreamAnswerDisplay(answerFromTimeline);
              setStreamThinkingTarget(streamingMsg.thinkingContent ?? "");
              setStreamThinkingDisplay(streamingMsg.thinkingContent ?? "");
              updateStreamTimeline(adoptedStream.timeline);
              setHasReceivedFirstToken(Boolean(answerFromTimeline || streamingMsg.thinkingContent));
              setIsSending(true);
            }
          }

          setMessages((current) => {
            const reconciliation = reconcileSnapshotMessages(
              current,
              msg.messages as Message[],
              streamMessageId,
              pendingLocalSubmissionsRef.current
            );
            pendingLocalSubmissionsRef.current = reconciliation.pendingLocalSubmissions;
            return reconciliation.messages;
          });
          break;
        case "queue_updated":
          setQueuedMessages((msg.queuedMessages as QueuedMessage[] | undefined) ?? []);
          break;
        case "error":
          if (isQueuedMessageOperationError(msg.message)) {
            setError(msg.message);
            break;
          }

          clearCompactionIndicator();
          setIsConversationActive(false);
          dispatchConversationActivityUpdated({
            conversationId: payload.conversation.id,
            isActive: false
          });
          setMessages((current) => {
            const activeStreamMessageId = streamMessageIdRef.current;
            if (activeStreamMessageId) {
              return current.map((m) =>
                m.id === activeStreamMessageId ? { ...m, status: "error" as const } : m
              );
            }
            return current;
          });
          setError(msg.message);
          setStreamMessageId(null);
          updateStreamTimeline([]);
          setIsSending(false);
          break;
        case "delta":
          handleDelta(msg.event as ChatStreamEvent);
          break;
      }
    }
  });

  useEffect(() => {
    wsSubscribe(payload.conversation.id);
    return () => {
      wsUnsubscribe(payload.conversation.id);
    };
  }, [payload.conversation.id, wsSubscribe, wsUnsubscribe]);

  useEffect(() => {
    bootstrapPayloadRef.current = readChatBootstrap(payload.conversation.id);
    bootstrapSubmittedRef.current = false;
  }, [payload.conversation.id]);

  useEffect(() => {
    if (!wsConnected || bootstrapSubmittedRef.current) {
      return;
    }

    const bootstrapPayload = bootstrapPayloadRef.current;

    if (!bootstrapPayload) {
      return;
    }

    bootstrapSubmittedRef.current = true;
    clearChatBootstrap(payload.conversation.id);
    void submitRef.current(bootstrapPayload.message, bootstrapPayload.attachments, bootstrapPayload.personaId);
  }, [payload.conversation.id, wsConnected]);

  useEffect(() => {
    if (!wsFailed) {
      return;
    }

    if (pendingLocalSubmissionsRef.current.length > 0) {
      const failedIds = new Set(
        pendingLocalSubmissionsRef.current.map((submission) => submission.localMessageId)
      );
      const latestSubmission =
        pendingLocalSubmissionsRef.current[pendingLocalSubmissionsRef.current.length - 1];

      setMessages((current) => current.filter((message) => !failedIds.has(message.id)));
      setInput((current) => current || latestSubmission?.content || "");
      setPendingAttachments((current) =>
        current.length > 0 ? current : (latestSubmission?.attachments ?? [])
      );
      pendingLocalSubmissionsRef.current = [];
    }

    setIsSending(false);
    setError(
      "Realtime chat connection is unavailable. Restart Eidon with the websocket server enabled."
    );
  }, [wsFailed]);

  function stopTitlePolling() {
    if (titlePollTimeoutRef.current !== null) {
      window.clearTimeout(titlePollTimeoutRef.current);
      titlePollTimeoutRef.current = null;
    }
  }

  function stopMessageSyncPolling() {
    if (messageSyncTimeoutRef.current !== null) {
      window.clearTimeout(messageSyncTimeoutRef.current);
      messageSyncTimeoutRef.current = null;
    }
  }

  async function pollConversationTitle() {
    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Unable to refresh conversation");
      }

      const result = (await response.json()) as {
        conversation: Conversation;
      };

      setConversationTitle((current) => {
        if (current !== result.conversation.title) {
          dispatchConversationTitleUpdated({
            conversationId: result.conversation.id,
            title: result.conversation.title
          });
        }

        return result.conversation.title;
      });
      setTitleGenerationStatus(result.conversation.titleGenerationStatus);

      if (
        result.conversation.titleGenerationStatus === "completed" ||
        result.conversation.titleGenerationStatus === "failed"
      ) {
        stopTitlePolling();
        return;
      }
    } catch {}

    titlePollAttemptsRef.current += 1;

    if (titlePollAttemptsRef.current >= 20) {
      stopTitlePolling();
      return;
    }

    titlePollTimeoutRef.current = window.setTimeout(() => {
      void pollConversationTitle();
    }, 1000);
  }

  function startTitlePolling() {
    if (
      titlePollTimeoutRef.current !== null ||
      titleGenerationStatus !== "pending"
    ) {
      return;
    }

    titlePollAttemptsRef.current = 0;
    titlePollTimeoutRef.current = window.setTimeout(() => {
      void pollConversationTitle();
    }, 400);
  }

  useEffect(() => stopTitlePolling, []);

  useEffect(() => stopMessageSyncPolling, []);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") {
        return;
      }

      if (window.location.pathname === `/chat/${payload.conversation.id}`) {
        return;
      }

      if (messagesRef.current.length > 0) {
        return;
      }

      void deleteConversationIfStillEmpty(payload.conversation.id).catch(() => {});
    };
  }, [payload.conversation.id]);

  useEffect(() => {
    if (titleGenerationStatus === "completed" || titleGenerationStatus === "failed") {
      stopTitlePolling();
    }
  }, [titleGenerationStatus]);

  useEffect(() => {
    if (!needsMessageSync) {
      stopMessageSyncPolling();
      return;
    }

    let cancelled = false;

    const syncConversation = async () => {
      try {
        const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error("Unable to refresh conversation");
        }

        const result = (await response.json()) as {
          conversation: Conversation;
          messages: Message[];
        };

        if (cancelled) {
          return;
        }

        const activeStreamMessageId = streamMessageIdRef.current;
        const hasLocalStreamState =
          Boolean(activeStreamMessageId) ||
          Boolean(streamThinkingTargetRef.current) ||
          Boolean(streamAnswerTargetRef.current) ||
          streamTimelineRef.current.length > 0;

        setMessages((current) => {
          const reconciliation = reconcileSnapshotMessages(
            current,
            result.messages,
            activeStreamMessageId,
            pendingLocalSubmissionsRef.current
          );
          pendingLocalSubmissionsRef.current = reconciliation.pendingLocalSubmissions;
          return reconciliation.messages;
        });
        setConversationTitle(result.conversation.title);
        setTitleGenerationStatus(result.conversation.titleGenerationStatus);

        const activeMessage = activeStreamMessageId
          ? result.messages.find((message) => message.id === activeStreamMessageId)
          : null;

        const shouldIgnoreInactiveResult =
          !result.conversation.isActive &&
          hasLocalStreamState &&
          (!activeMessage || activeMessage.status === "streaming");

        if (shouldIgnoreInactiveResult) {
          messageSyncTimeoutRef.current = window.setTimeout(() => {
            void syncConversation();
          }, 1000);
          return;
        }

        if (!result.conversation.isActive || (activeMessage && activeMessage.status !== "streaming")) {
          setStreamMessageId(null);
          updateStreamTimeline([]);
          setStreamAnswerTarget("");
          setStreamAnswerDisplay("");
          setStreamThinkingTarget("");
          setStreamThinkingDisplay("");
          streamAnswerTargetRef.current = "";
          streamThinkingTargetRef.current = "";
          setHasReceivedFirstToken(false);
          setIsSending(false);
          stopMessageSyncPolling();
          return;
        }
      } catch {}

      if (cancelled) {
        return;
      }

      messageSyncTimeoutRef.current = window.setTimeout(() => {
        void syncConversation();
      }, 1000);
    };

    void syncConversation();

    return () => {
      cancelled = true;
      stopMessageSyncPolling();
    };
  }, [needsMessageSync, payload.conversation.id, streamMessageId]);

  useEffect(() => {
    if (streamThinkingDisplay === streamThinkingTarget) {
      return;
    }

    const handle = window.setInterval(() => {
      setStreamThinkingDisplay((current) => {
        if (current.length >= streamThinkingTarget.length) {
          window.clearInterval(handle);
          return current;
        }

        return streamThinkingTarget.slice(0, current.length + 3);
      });
    }, 12);

    return () => window.clearInterval(handle);
  }, [streamThinkingDisplay, streamThinkingTarget]);

  useEffect(() => {
    if (streamAnswerDisplay === streamAnswerTarget) {
      return;
    }

    const handle = window.setInterval(() => {
      setStreamAnswerDisplay((current) => {
        if (current.length >= streamAnswerTarget.length) {
          window.clearInterval(handle);
          return current;
        }

        return streamAnswerTarget.slice(0, current.length + 4);
      });
    }, 10);

    return () => window.clearInterval(handle);
  }, [streamAnswerDisplay, streamAnswerTarget]);

  const selectedProfile = useMemo(
    () => payload.providerProfiles.find((profile) => profile.id === providerProfileId) ?? null,
    [payload.providerProfiles, providerProfileId]
  );

  const hasPendingImages = pendingAttachments.some((attachment) => attachment.kind === "image");
  const showVisionWarning =
    hasPendingImages &&
    selectedProfile &&
    selectedProfile.visionMode === "none";

  async function uploadFiles(files: File[]) {
    if (!files.length) {
      return;
    }

    setError("");
    setIsUploadingAttachments(true);

    try {
      const formData = new FormData();
      formData.append("conversationId", payload.conversation.id);
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/attachments", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        let message = "Unable to upload attachments";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const data = (await response.json()) as { attachments: MessageAttachment[] };
      setPendingAttachments((current) => [...current, ...data.attachments]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to upload attachments"
      );
    } finally {
      setIsUploadingAttachments(false);
    }
  }

  async function removePendingAttachment(attachmentId: string) {
    setError("");

    try {
      const response = await fetch(`/api/attachments/${attachmentId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        let message = "Unable to remove attachment";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      setPendingAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId)
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to remove attachment"
      );
    }
  }

  async function updateUserMessage(messageId: string, content: string) {
    const previousMessage = messages.find((message) => message.id === messageId);

    if (!previousMessage) {
      return;
    }

    setError("");
    setUpdatingMessageId(messageId);

    try {
      const response = await fetch(`/api/messages/${messageId}/edit-restart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });

      if (!response.ok) {
        let message = "Unable to restart from edited message";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const result = (await response.json()) as {
        conversation?: Conversation;
        messages?: Message[];
      };

      resetStreamingState();

      if (result.messages) {
        setMessages(sanitizeMessages(result.messages));
      }

      if (result.conversation) {
        setConversationTitle(result.conversation.title);
        setTitleGenerationStatus(result.conversation.titleGenerationStatus);
        dispatchConversationActivityUpdated({
          conversationId: result.conversation.id,
          isActive: true
        });
      }

      setIsSending(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update message");
      throw caughtError;
    } finally {
      setUpdatingMessageId((current) => (current === messageId ? null : current));
    }
  }

  async function forkAssistantMessage(messageId: string) {
    if (forkingMessageId) {
      return;
    }

    setError("");
    setForkingMessageId(messageId);

    try {
      const response = await fetch(`/api/messages/${messageId}/fork`, {
        method: "POST"
      });

      if (!response.ok) {
        let message = "Unable to fork conversation";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const result = (await response.json()) as {
        conversation?: {
          id?: string;
        };
      };
      const nextConversationId = result.conversation?.id;

      if (!nextConversationId) {
        throw new Error("Unable to fork conversation");
      }

      router.push(`/chat/${nextConversationId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to fork conversation"
      );
    } finally {
      setForkingMessageId((current) => (current === messageId ? null : current));
    }
  }

  async function approveMemoryProposal(
    actionId: string,
    overrides?: { content?: string; category?: MemoryCategory }
  ) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(overrides ?? {})
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to approve memory proposal");
      }

      setMessages((current) => replaceMessageAction(current, result.action!));
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to approve memory proposal";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function dismissMemoryProposal(actionId: string) {
    setError("");

    try {
      const response = await fetch(`/api/message-actions/${actionId}/dismiss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      const result = (await response.json()) as {
        action?: MessageAction;
        error?: string;
      };

      if (!response.ok || !result.action) {
        throw new Error(result.error ?? "Unable to dismiss memory proposal");
      }

      setMessages((current) => replaceMessageAction(current, result.action!));
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to dismiss memory proposal";
      setError(errorMessage);
      throw caughtError instanceof Error ? caughtError : new Error(errorMessage);
    }
  }

  async function updateProviderProfile(nextProviderProfileId: string) {
    const previousProviderProfileId = providerProfileId;
    setError("");
    setProviderProfileId(nextProviderProfileId);

    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ providerProfileId: nextProviderProfileId })
      });

      if (!response.ok) {
        let message = "Unable to update provider profile";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      router.refresh();
    } catch (caughtError) {
      setProviderProfileId(previousProviderProfileId);
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to update provider profile"
      );
    }
  }

  async function submit(
    nextInput = input,
    nextPendingAttachments = pendingAttachments,
    nextPersonaId?: string
  ) {
    const value = nextInput.trim();
    const effectivePersonaId = nextPersonaId ?? personaId;
    const hasActiveTurn =
      isConversationActive ||
      Boolean(streamMessageIdRef.current) ||
      messagesRef.current.some(
        (message) => message.role === "assistant" && message.status === "streaming"
      );

    if (
      speechSnapshot.phase === "listening" ||
      speechSnapshot.phase === "transcribing" ||
      isUploadingAttachments ||
      updatingMessageId !== null
    ) {
      return;
    }

    if (wsFailed) {
      setError(
        "Realtime chat connection is unavailable. Restart Eidon with the websocket server enabled."
      );
      return;
    }

    if (hasActiveTurn) {
      if (!value) {
        return;
      }

      setError("");
      setInput("");
      wsSend({
        type: "queue_message",
        conversationId: payload.conversation.id,
        content: value
      });
      return;
    }

    if ((!value && nextPendingAttachments.length === 0) || isSending) {
      return;
    }

    setError("");
    setInput("");
    setPendingAttachments([]);
    setStreamThinkingTarget("");
    setStreamThinkingDisplay("");
    setStreamAnswerTarget("");
    setStreamAnswerDisplay("");
    streamAnswerTargetRef.current = "";
    streamThinkingTargetRef.current = "";
    setStreamMessageId(null);
    updateStreamTimeline([]);
    setHasReceivedFirstToken(false);
    thinkingStartTimeRef.current = null;
    setThinkingDuration(undefined);
    setIsSending(true);

    const optimisticUserMessage = {
      id: `local_${Date.now()}`,
      conversationId: payload.conversation.id,
      role: "user" as const,
      content: value,
      thinkingContent: "",
      status: "completed" as const,
      estimatedTokens: 0,
      systemKind: null,
      compactedAt: null,
      createdAt: new Date().toISOString(),
      attachments: nextPendingAttachments
    };
    pendingLocalSubmissionsRef.current.push({
      localMessageId: optimisticUserMessage.id,
      content: value,
      attachments: nextPendingAttachments,
      serverMessageId: null
    });
    setMessages((current) => [...current, optimisticUserMessage]);

    wsSend({
      type: "message",
      conversationId: payload.conversation.id,
      content: value,
      attachmentIds: nextPendingAttachments.map((attachment) => attachment.id),
      personaId: effectivePersonaId ?? undefined
    });
    setIsConversationActive(true);

    if (titleGenerationStatus === "pending") {
      startTitlePolling();
    }
  }

  function stopActiveTurn() {
    if (!streamMessageIdRef.current || isStopPending) {
      return;
    }

    setIsStopPending(true);
    wsSend({
      type: "stop",
      conversationId: payload.conversation.id
    });
  }

  submitRef.current = submit;

  function ensureRealtimeConnection() {
    if (!wsFailed) {
      return true;
    }

    setError(
      "Realtime chat connection is unavailable. Restart Eidon with the websocket server enabled."
    );
    return false;
  }

  async function updateQueuedMessage(queuedMessageId: string, content: string) {
    if (!ensureRealtimeConnection()) {
      return;
    }

    setError("");
    wsSend({
      type: "update_queued_message",
      conversationId: payload.conversation.id,
      queuedMessageId,
      content
    });
  }

  async function deleteQueuedMessage(queuedMessageId: string) {
    if (!ensureRealtimeConnection()) {
      return;
    }

    setError("");
    wsSend({
      type: "delete_queued_message",
      conversationId: payload.conversation.id,
      queuedMessageId
    });
  }

  async function sendQueuedMessageNow(queuedMessageId: string) {
    if (!ensureRealtimeConnection()) {
      return;
    }

    setError("");
    wsSend({
      type: "send_queued_message_now",
      conversationId: payload.conversation.id,
      queuedMessageId
    });
  }

  return (
    <div
      data-testid="chat-view-root"
      className="relative flex min-h-0 flex-1 w-full flex-col bg-[var(--background)]"
    >
      <div
        className="contents"
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) {
            return;
          }

          event.preventDefault();
          dragDepthRef.current += 1;
          setIsDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) {
            return;
          }

          event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes("Files")) {
            return;
          }

          event.preventDefault();
          dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);

          if (dragDepthRef.current === 0) {
            setIsDraggingFiles(false);
          }
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) {
            return;
          }

          event.preventDefault();
          dragDepthRef.current = 0;
          setIsDraggingFiles(false);
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
      >
      {isDraggingFiles ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--panel)] px-6 py-5 text-center shadow-[var(--shadow)]">
            <div className="text-sm font-medium text-[var(--text)]">Drop files to attach</div>
            <div className="mt-1 text-xs text-white/45">
              Images and text-like files are supported
            </div>
          </div>
        </div>
      ) : null}
      <div className="border-b border-white/4 px-4 py-3.5 md:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="font-medium text-[var(--text)] truncate text-sm">{conversationTitle}</div>
          </div>
        </div>
      </div>

      <div
        ref={queueRef}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 md:px-8 relative z-0 isolate"
        onScroll={() => {
          if (!queueRef.current) {
            return;
          }

          const nextIsAtBottom = isNearQueueBottom(queueRef.current);
          setIsConversationAtBottom(nextIsAtBottom);
          shouldAutoScrollRef.current = nextIsAtBottom;
        }}
      >
        <div className="flex w-full flex-col gap-2.5 md:gap-4 px-2 md:px-0 pt-4 pb-[180px] md:pb-[200px]">
          {renderableMessages.map((message) => (
            <div
              key={message.id}
              className="animate-slide-up"
              style={{ animationFillMode: "forwards" }}
            >
              <MessageBubble
                message={message}
                onPreviewAttachment={previewController.openAttachmentPreview}
                streamingTimeline={message.id === streamMessageId ? streamTimeline : undefined}
                streamingThinking={message.id === streamMessageId ? streamThinkingDisplay : undefined}
                streamingAnswer={message.id === streamMessageId ? streamAnswerDisplay : undefined}
                awaitingFirstToken={
                  message.id === streamMessageId
                    ? !hasReceivedFirstToken &&
                      !streamAnswerDisplay &&
                      !message.content &&
                      !(message.timeline?.length ?? 0)
                    : false
                }
                compactionInProgress={message.id === streamMessageId ? compactionInProgress : false}
                thinkingInProgress={
                  message.id === streamMessageId
                    ? Boolean(streamThinkingTarget) && !streamAnswerTarget
                    : false
                }
                thinkingDuration={message.id === streamMessageId ? thinkingDuration : undefined}
                hasThinking={message.id === streamMessageId ? Boolean(streamThinkingTarget) : false}
                onUpdateUserMessage={updateUserMessage}
                onApproveMemoryProposal={approveMemoryProposal}
                onDismissMemoryProposal={dismissMemoryProposal}
                isUpdating={updatingMessageId === message.id}
                onForkAssistantMessage={forkAssistantMessage}
                isForking={forkingMessageId === message.id}
              />
            </div>
          ))}

          {error ? (
            <div className="mt-3 rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300 text-center animate-slide-up">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
        <div className="mx-auto w-full px-4 md:px-8 max-w-[980px] pointer-events-auto relative">
          <div ref={queueBannerRef}>
            <QueuedMessageBanner
              items={queuedMessages}
              onEdit={updateQueuedMessage}
              onDelete={deleteQueuedMessage}
              onSendNow={sendQueuedMessageNow}
            />
          </div>
          {!isConversationAtBottom ? (
            <div className={cn(
              "pointer-events-none absolute z-50 flex items-center",
              "left-3 sm:left-5",
              queueBannerHeight > 0
                ? "-top-10 md:left-[-12px] md:-translate-x-full md:-translate-y-1/2 md:bottom-4 md:top-auto"
                : "bottom-full mb-2 translate-y-0 md:left-[-12px] md:-translate-x-full md:-translate-y-1/2 md:top-1/2 md:bottom-auto md:mb-0"
            )}>
              <button
                type="button"
                onClick={jumpToBottom}
                className="pointer-events-auto relative inline-flex h-8 w-8 items-center justify-center gap-2 rounded-full border border-[var(--accent)]/45 bg-[var(--panel)] px-2 text-[var(--accent)] shadow-[0_2px_12px_rgba(0,0,0,0.45)] transition-colors duration-150 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[var(--accent)] before:opacity-0 before:transition-opacity before:duration-150 hover:before:opacity-[0.16] active:scale-95 md:w-auto md:min-w-[8rem] md:justify-start"
                aria-label="Scroll to newest messages"
                title="Scroll to bottom"
              >
                ↓
                <span className="hidden md:inline text-[11px] font-medium text-[var(--text)]/85">Latest messages</span>
              </button>
            </div>
          ) : null}
          <div className="relative">
          <ChatComposer
            input={input}
            onInputChange={setInput}
            onSubmit={submit}
            isSending={isSending || updatingMessageId !== null}
            pendingAttachments={pendingAttachments}
            isUploadingAttachments={isUploadingAttachments}
            onUploadFiles={uploadFiles}
            onRemovePendingAttachment={removePendingAttachment}
            showVisionWarning={Boolean(showVisionWarning)}
            providerProfiles={payload.providerProfiles}
            providerProfileId={providerProfileId}
            onProviderProfileChange={updateProviderProfile}
            personas={personas}
            personaId={personaId}
            onPersonaChange={setPersonaId}
            textareaRef={inputRef}
            usedTokens={usedTokens}
            modelContextLimit={selectedProfile?.modelContextLimit ?? 128000}
            compactionThreshold={selectedProfile?.compactionThreshold ?? 0.8}
            hasMessages={messages.length > 0}
            canStop={!!streamMessageId && !isStopPending}
            isStopPending={isStopPending}
            onStop={stopActiveTurn}
            speechPhase={speechSnapshot.phase}
            speechLevel={speechSnapshot.level}
            speechError={speechSnapshot.error}
            queueingEnabled={isConversationActive}
            onStartSpeech={() => {
              setError("");
              void startSpeech();
            }}
            onStopSpeech={() => {
              void stopSpeech().then((transcript) => {
                if (!transcript) {
                  return;
                }

                setInput((current) => appendTranscriptToDraft(current, transcript));
              });
            }}
          />
          </div>
        </div>
      </div>
      {previewController.previewAttachment ? (
        <AttachmentPreviewModal
          attachment={previewController.previewAttachment}
          state={previewController.previewState}
          onClose={previewController.closeAttachmentPreview}
          onRetry={() =>
            void previewController.openAttachmentPreview(
              previewController.previewAttachment!
            )
          }
        />
      ) : null}
      </div>
    </div>
  );
}

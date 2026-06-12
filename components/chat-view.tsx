"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation as ConversationContainer,
  ConversationContent,
  ConversationScrollButton
} from "@/components/ai-elements/conversation";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useRouter } from "next/navigation";
import { Plus, Share2 } from "lucide-react";

import {
  AttachmentPreviewModal,
  useAttachmentPreviewController
} from "@/components/attachment-preview-modal";
import { ChatComposer } from "@/components/chat-composer";
import { QueuedMessageBanner } from "@/components/queued-message-banner";
import { MessageBubble, TypingIndicator } from "@/components/message-bubble";
import { useShareConversation } from "@/components/share-conversation-context";
import {
  type PendingLocalSubmission,
  adoptStreamingSnapshotState,
  appendStreamingAction,
  getAttachmentIdSignature,
  isQueuedMessageOperationError,
  matchesPendingLocalSubmission,
  mergeStreamingSnapshotTimeline,
  reconcileSnapshotMessages,
  replaceMessageAction,
  sanitizeMessages,
  shouldShowProvisionalImageAction,
  updateStreamingAction
} from "@/components/chat-snapshot-helpers";
import { clearChatBootstrap, readChatBootstrap } from "@/lib/chat-bootstrap";
import { createStreamBuffer } from "@/lib/stream-buffer";
import { StreamingMessage } from "@/components/streaming-message";
import { useStableHandler } from "@/lib/use-stable-handler";
import { useContextTokens } from "@/lib/context-tokens-context";
import {
  dispatchConversationActivityUpdated,
  dispatchConversationTitleUpdated
} from "@/lib/conversation-events";
import { useWebSocket } from "@/lib/ws-client";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { appendTranscriptToDraft } from "@/lib/speech/append-transcript-to-draft";
import { useSpeechInput } from "@/lib/speech/use-speech-input";
import { shouldAutofocusTextInput } from "@/lib/utils";
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
  contextTokens: number | null;
  compactionLimit: number;
  debug: {
    rawTurnCount: number;
    memoryNodeCount: number;
    latestCompactionAt: string | null;
  };
};


function StickToBottomBridge({
  onAtBottomChange,
  scrollToBottomRef
}: {
  onAtBottomChange: (atBottom: boolean) => void;
  scrollToBottomRef: React.MutableRefObject<(() => void) | null>;
}) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const prevRef = useRef(isAtBottom);
  if (prevRef.current !== isAtBottom) {
    prevRef.current = isAtBottom;
    onAtBottomChange(isAtBottom);
  }

  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
    return () => { scrollToBottomRef.current = null; };
  }, [scrollToBottom, scrollToBottomRef]);

  return null;
}

export function ChatView({ payload }: { payload: ConversationPayload }) {
  const router = useRouter();
  const { getTokenUsage, setTokenUsage } = useContextTokens();
  const { canShare, openShareModal } = useShareConversation();
  const previewController = useAttachmentPreviewController();
  const { closeAttachmentPreview } = previewController;
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
  const [isTemporaryToggled, setIsTemporaryToggled] = useState(payload.conversation.isTemporary);
  const streamBufferRef = useRef<ReturnType<typeof createStreamBuffer> | null>(null);
  streamBufferRef.current ??= createStreamBuffer();
  const streamBuffer = streamBufferRef.current;
  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const [streamTimeline, setStreamTimeline] = useState<MessageTimelineItem[]>([]);
  const [hasReceivedFirstToken, setHasReceivedFirstToken] = useState(false);
  const [compactionInProgress, setCompactionInProgress] = useState(false);
  const [usedTokens, setUsedTokens] = useState<number | null>(() => payload.contextTokens);
  const [compactionLimit, setCompactionLimit] = useState<number>(payload.compactionLimit);
  const [isConversationActive, setIsConversationActive] = useState(payload.conversation.isActive);
  const hasInitializedTokensRef = useRef(false);

  useEffect(() => {
    if (!hasInitializedTokensRef.current) {
      hasInitializedTokensRef.current = true;
      if (payload.contextTokens === null) {
        const tokens = getTokenUsage(payload.conversation.id);
        if (tokens !== null) {
          setUsedTokens(tokens);
        }
      }
    }
  }, [payload.conversation.id, payload.contextTokens, getTokenUsage]);

  useEffect(() => {
    if (activeConversationIdRef.current === payload.conversation.id) {
      return;
    }

    activeConversationIdRef.current = payload.conversation.id;
    closeAttachmentPreview();
  }, [payload.conversation.id, closeAttachmentPreview]);

  const compactionInProgressRef = useRef(false);
  const thinkingStartTimeRef = useRef<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number | undefined>(undefined);
  function resolveProviderProfileId(
    conversationProviderId: string | null,
    profiles: ProviderProfileSummary[],
    defaultId: string | null
  ) {
    const profileIds = new Set(profiles.map((p) => p.id));
    if (conversationProviderId && profileIds.has(conversationProviderId)) {
      return conversationProviderId;
    }
    if (defaultId && profileIds.has(defaultId)) {
      return defaultId;
    }
    return profiles[0]?.id ?? "";
  }

  const [providerProfileId, setProviderProfileId] = useState(
    () => resolveProviderProfileId(
      payload.conversation.providerProfileId,
      payload.providerProfiles,
      payload.defaultProviderProfileId
    )
  );
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [personas, setPersonas] = useState<Array<{ id: string; name: string }>>([]);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const queueBannerRef = useRef<HTMLDivElement>(null);
  const viewportHeightRef = useRef(800);
  const anchorSpacerRef = useRef<HTMLDivElement>(null);
  const composerAreaRef = useRef<HTMLDivElement>(null);
  const [composerAreaHeight, setComposerAreaHeight] = useState(160);
  const [queueBannerHeight, setQueueBannerHeight] = useState(0);
  const [isAgentIdle, setIsAgentIdle] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    speechSnapshot,
    startSpeech,
    stopSpeech
  } = useSpeechInput({
    engine: payload.settings.sttEngine,
    initialLanguage: payload.settings.sttLanguage,
    resetKey: payload.conversation.id
  });
  const hasEmptyAssistantShell = useMemo(
    () =>
      messages.some(
        (message) =>
          message.role === "assistant" &&
          !message.content &&
          !(message.timeline?.length ?? 0) &&
          (message.status === "streaming" || message.status === "completed")
      ),
    [messages]
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);
  const messagesRef = useRef(payload.messages);
  const streamMessageIdRef = useRef<string | null>(null);
  const renderKeyByMessageIdRef = useRef(new Map<string, string>());
  const wsConnectedRef = useRef(false);
  const streamTimelineRef = useRef<MessageTimelineItem[]>([]);
  const isSendingRef = useRef(false);
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const titlePollTimeoutRef = useRef<number | null>(null);
  const titlePollAttemptsRef = useRef(0);
  const messageSyncTimeoutRef = useRef<number | null>(null);
  const pendingLocalSubmissionsRef = useRef<PendingLocalSubmission[]>([]);
  const initialMessageIdsRef = useRef<Set<string> | null>(null);
  const animatedMessageIdsRef = useRef<Set<string>>(new Set());

  const pendingAnchorMessageIdRef = useRef<string | null>(null);
  const bootstrapPayloadRef = useRef<{
    message: string;
    attachments: MessageAttachment[];
    personaId?: string;
  } | null>(null);
  const bootstrapSubmittedRef = useRef(false);
  const submitRef = useRef<
    (nextInput?: string, nextPendingAttachments?: MessageAttachment[], nextPersonaId?: string) => Promise<void>
  >(async () => {});
  const renderableMessages = useMemo(() => {
    const pendingById = new Map(
      pendingLocalSubmissionsRef.current.map((submission) => [
        submission.localMessageId,
        submission
      ] as const)
    );
    const serverUserSignatures = new Set(
      messages
        .filter((message) => !message.id.startsWith("local_") && message.role === "user")
        .map(
          (message) =>
            `${message.content} ${getAttachmentIdSignature(message.attachments)}`
        )
    );

    return messages.filter((message) => {
      if (!message.id.startsWith("local_")) {
        return true;
      }

      const pendingSubmission = pendingById.get(message.id);

      if (pendingSubmission) {
        return pendingSubmission.serverMessageId === null;
      }

      if (message.role !== "user") {
        return true;
      }

      return !serverUserSignatures.has(
        `${message.content} ${getAttachmentIdSignature(message.attachments)}`
      );
    });
  }, [messages]);
  const hasPendingLocalSubmission = pendingLocalSubmissionsRef.current.length > 0;
  const lastUserMsgIndex = useMemo(() => {
    for (let i = renderableMessages.length - 1; i >= 0; i--) {
      if (renderableMessages[i].role === "user") return i;
    }
    return -1;
  }, [renderableMessages]);
  const needsMessageSync =
    isSending ||
    hasPendingLocalSubmission ||
    streamMessageId !== null ||
    messages.some((message) => message.role === "assistant" && message.status === "streaming") ||
    hasEmptyAssistantShell;

  const updateStreamTimeline = useCallback((
    nextTimeline:
      | MessageTimelineItem[]
      | ((previous: MessageTimelineItem[]) => MessageTimelineItem[])
  ) => {
    const resolvedTimeline =
      typeof nextTimeline === "function"
        ? nextTimeline(streamTimelineRef.current)
        : nextTimeline;
    streamTimelineRef.current = resolvedTimeline;
    setStreamTimeline(resolvedTimeline);
  }, []);

  const syncActiveStreamingMessageFromSnapshot = useCallback((snapshotMessage: Message) => {
    const adoptedStream = adoptStreamingSnapshotState(snapshotMessage.timeline);
    const bufferSnapshot = streamBuffer.getSnapshot();
    const nextAnswer =
      bufferSnapshot.answerTarget.length >= adoptedStream.answer.length
        ? bufferSnapshot.answerTarget
        : adoptedStream.answer;
    const nextThinkingCandidate = snapshotMessage.thinkingContent ?? "";
    const nextThinking =
      bufferSnapshot.thinkingTarget.length >= nextThinkingCandidate.length
        ? bufferSnapshot.thinkingTarget
        : nextThinkingCandidate;
    const mergedTimeline = mergeStreamingSnapshotTimeline(
      streamTimelineRef.current,
      adoptedStream.timeline
    );

    streamBuffer.setAnswer(nextAnswer);
    streamBuffer.setThinking(nextThinking);
    setStreamMessageId(snapshotMessage.id);
    updateStreamTimeline(mergedTimeline);
    setHasReceivedFirstToken(Boolean(nextAnswer || nextThinking || mergedTimeline.length));
    setIsSending(true);
    setIsConversationActive(true);
  }, [streamBuffer, updateStreamTimeline]);

  useEffect(() => {
    setMessages((current) => {
      const incoming = sanitizeMessages(payload.messages);
      if (!current.length) return incoming;
      return incoming.map((msg) => {
        if (msg.status !== "error" || msg.content) return msg;
        const local = current.find((m) => m.id === msg.id);
        return local?.content ? { ...msg, content: local.content } : msg;
      });
    });
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
    isSendingRef.current = isSending;
  }, [isSending]);

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

  function recordRenderKeyRemaps(remap: Map<string, string>) {
    for (const [localId, serverId] of remap.entries()) {
      renderKeyByMessageIdRef.current.set(
        serverId,
        renderKeyByMessageIdRef.current.get(localId) ?? localId
      );
    }
  }

  function resetStreamingState() {
    clearCompactionIndicator();
    setStreamMessageId(null);
    updateStreamTimeline([]);
    streamBuffer.reset();
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
      resolveProviderProfileId(
        payload.conversation.providerProfileId,
        payload.providerProfiles,
        payload.defaultProviderProfileId
      )
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
    scrollToBottomRef.current?.();
    setIsAtBottom(true);
  }, [payload.conversation.id]);

  const jumpToBottom = useCallback(() => {
    scrollToBottomRef.current?.();
  }, []);

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
    const el = composerAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setComposerAreaHeight(el.offsetHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pendingAnchorMessageIdRef.current) return;
    const messageId = pendingAnchorMessageIdRef.current;
    const exists = renderableMessages.some((m) => m.id === messageId);
    if (!exists) return;

    pendingAnchorMessageIdRef.current = null;
    requestAnimationFrame(() => {
      if (anchorSpacerRef.current) {
        anchorSpacerRef.current.style.height = `${viewportHeightRef.current}px`;
      }
      const targetEl = document.querySelector(`[data-message-id="${messageId}"]`);
      targetEl?.scrollIntoView({ block: "start", behavior: "auto" });
      requestAnimationFrame(() => {
        if (anchorSpacerRef.current) {
          anchorSpacerRef.current.style.height = "";
        }
      });
    });
  }, [renderableMessages]);

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

  useEffect(() => {
    return () => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  function handleDelta(event: ChatStreamEvent) {
    if (event.type === "compaction_start") {
      setCompactionInProgress(true);
      resetIdleTimer();
      return;
    }

    if (event.type === "compaction_end") {
      setCompactionInProgress(false);
      resetIdleTimer();
      return;
    }

    if (event.type === "message_start") {
      setIsConversationActive(true);
      setStreamMessageId(event.messageId);
      streamMessageIdRef.current = event.messageId;
      setHasReceivedFirstToken(false);
      resetIdleTimer();
      streamBuffer.reset();
      updateStreamTimeline(
        shouldShowProvisionalImageAction(messagesRef.current)
          ? [
              {
                id: `local_image_generation_${event.messageId}`,
                messageId: event.messageId,
                timelineKind: "action",
                kind: "image_generation",
                status: "running",
                serverId: null,
                skillId: null,
                toolName: null,
                label: "Generate image",
                detail: "",
                arguments: null,
                resultSummary: "",
                sortOrder: 0,
                startedAt: new Date().toISOString(),
                completedAt: null,
                proposalState: null,
                proposalPayload: null,
                proposalUpdatedAt: null
              }
            ]
          : []
      );
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

    if (event.type === "context_usage") {
      setUsedTokens(event.contextTokens);
      setCompactionLimit(event.compactionLimit);
      setTokenUsage(payload.conversation.id, event.contextTokens);
      return;
    }

    if (event.type === "thinking_delta") {
      clearCompactionIndicator();
      setHasReceivedFirstToken(true);
      resetIdleTimer();
      streamBuffer.appendThinking(event.text);
      if (!thinkingStartTimeRef.current) {
        thinkingStartTimeRef.current = Date.now();
      }
    }

    if (event.type === "answer_delta") {
      clearCompactionIndicator();
      setHasReceivedFirstToken(true);
      resetIdleTimer();
      streamBuffer.appendAnswer(event.text);
      if (thinkingStartTimeRef.current) {
        const duration = (Date.now() - thinkingStartTimeRef.current) / 1000;
        setThinkingDuration((current) => current ?? duration);
      }
    }

    if (event.type === "system_notice") {
      resetIdleTimer();
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
      resetIdleTimer();
      updateStreamTimeline((prev) => {
        const isExisting = prev.some((item) => item.timelineKind === "action" && item.id === event.action.id);
        if (isExisting) {
          return appendStreamingAction(prev, event.action);
        }

        const previousTextLen = prev
          .filter((item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> => item.timelineKind === "text")
          .reduce((sum, item) => sum + item.content.length, 0);

        const newText = streamBuffer.getSnapshot().answerTarget.slice(previousTextLen);
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
      resetIdleTimer();
      updateStreamTimeline((prev) => updateStreamingAction(prev, event.action));
    }

    if (event.type === "done") {
      clearCompactionIndicator();
      clearIdleTimer();
      const wasStopped = isStopPending;
      setIsStopPending(false);

      const isForActiveStream = event.messageId === streamMessageIdRef.current;

      if (isForActiveStream) {
        setIsConversationActive(false);
        dispatchConversationActivityUpdated({
          conversationId: payload.conversation.id,
          isActive: false
        });
      }

      if (event.message) {
        setMessages((current) =>
          current.map((m) =>
            m.id === event.messageId
              ? { ...event.message, status: wasStopped ? ("stopped" as const) : ("completed" as const) } as Message
              : m
          )
        );
      } else if (isForActiveStream) {
        const bufferSnapshot = streamBuffer.getSnapshot();
        const finalAnswer = bufferSnapshot.answerTarget;
        const finalThinking = bufferSnapshot.thinkingTarget;
        const finalTimeline = streamTimelineRef.current;

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
      }

      if (isForActiveStream) {
        setStreamMessageId(null);
        updateStreamTimeline([]);
        streamBuffer.reset();
        setIsSending(false);
      }
    }

    if (event.type === "error") {
      clearCompactionIndicator();
      clearIdleTimer();
      setIsStopPending(false);
      const activeStreamMessageId = streamMessageIdRef.current;

      if (activeStreamMessageId) {
        setIsConversationActive(false);
        dispatchConversationActivityUpdated({
          conversationId: payload.conversation.id,
          isActive: false
        });
        setMessages((current) =>
          current.map((m) =>
            m.id === activeStreamMessageId ? { ...m, status: "error" as const, content: event.message } : m
          )
        );
        setStreamMessageId(null);
        updateStreamTimeline([]);
        streamBuffer.reset();
        setIsSending(false);
      }
      setError("");
    }
  }

  function resetIdleTimer() {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
    setIsAgentIdle(false);
    idleTimerRef.current = setTimeout(() => {
      setIsAgentIdle(true);
    }, 1200);
  }

  function clearIdleTimer() {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setIsAgentIdle(false);
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
              streamBuffer.reset();
              setHasReceivedFirstToken(false);
              setIsSending(false);
            } else if (activeSnapshotMessage) {
              syncActiveStreamingMessageFromSnapshot(activeSnapshotMessage);
            }
          } else {
            const streamingMsg = (msg.messages as Message[]).find(
              (message) => message.status === "streaming" && message.role === "assistant"
            );
            if (streamingMsg) {
              const adoptedStream = adoptStreamingSnapshotState(streamingMsg.timeline);
              setStreamMessageId(streamingMsg.id);
              streamBuffer.setAnswer(adoptedStream.answer, { immediate: true });
              streamBuffer.setThinking(streamingMsg.thinkingContent ?? "", { immediate: true });
              updateStreamTimeline(adoptedStream.timeline);
              setHasReceivedFirstToken(Boolean(adoptedStream.answer || streamingMsg.thinkingContent));
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
            const remappedAnchorMessageId = pendingAnchorMessageIdRef.current
              ? reconciliation.anchorMessageIdRemap.get(pendingAnchorMessageIdRef.current)
              : undefined;
            if (remappedAnchorMessageId) {
              pendingAnchorMessageIdRef.current = remappedAnchorMessageId;
            }
            pendingLocalSubmissionsRef.current = reconciliation.pendingLocalSubmissions;
            recordRenderKeyRemaps(reconciliation.anchorMessageIdRemap);
            return reconciliation.messages;
          });
          break;
        case "user_message_persisted": {
          if (msg.conversationId !== payload.conversation.id) {
            break;
          }
          const serverMessage = sanitizeMessages([msg.message as Message])[0];
          if (!serverMessage) {
            break;
          }
          const submission = pendingLocalSubmissionsRef.current.find(
            (candidate) =>
              candidate.serverMessageId === null &&
              matchesPendingLocalSubmission(serverMessage, candidate)
          );
          if (submission) {
            renderKeyByMessageIdRef.current.set(
              serverMessage.id,
              renderKeyByMessageIdRef.current.get(submission.localMessageId) ?? submission.localMessageId
            );
            if (pendingAnchorMessageIdRef.current === submission.localMessageId) {
              pendingAnchorMessageIdRef.current = serverMessage.id;
            }
            pendingLocalSubmissionsRef.current = pendingLocalSubmissionsRef.current.filter(
              (candidate) => candidate.localMessageId !== submission.localMessageId
            );
          }
          setMessages((current) => {
            if (current.some((m) => m.id === serverMessage.id)) {
              return current;
            }
            if (submission && current.some((m) => m.id === submission.localMessageId)) {
              return current.map((m) => (m.id === submission.localMessageId ? serverMessage : m));
            }
            return [...current, serverMessage];
          });
          break;
        }
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
                m.id === activeStreamMessageId ? { ...m, status: "error" as const, content: msg.message } : m
              );
            }
            return current;
          });
          setError("");
          setStreamMessageId(null);
          updateStreamTimeline([]);
          streamBuffer.reset();
          setIsSending(false);
          break;
        case "delta":
          handleDelta(msg.event as ChatStreamEvent);
          break;
        case "conversation_title_updated":
          if (msg.conversationId === payload.conversation.id) {
            setConversationTitle(msg.title);
            setTitleGenerationStatus("completed");
            dispatchConversationTitleUpdated({
              conversationId: msg.conversationId,
              title: msg.title
            });
            stopTitlePolling();
          }
          break;
      }
    }
  });

  useEffect(() => () => streamBuffer.reset(), [streamBuffer]);

  useEffect(() => {
    wsConnectedRef.current = wsConnected;
  }, [wsConnected]);

  useEffect(() => {
    wsSubscribe(payload.conversation.id);
    return () => {
      wsUnsubscribe(payload.conversation.id);
    };
  }, [payload.conversation.id, wsSubscribe, wsUnsubscribe]);

  useEffect(() => {
    const bootstrap = readChatBootstrap(payload.conversation.id);
    bootstrapPayloadRef.current = bootstrap;
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
    if (!isTemporaryToggled) {
      return;
    }

    const conversationId = payload.conversation.id;

    const handleBeforeUnload = () => {
      fetch(`/api/conversations/${conversationId}`, { method: "DELETE", keepalive: true }).catch(() => {});
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);

      if (typeof window === "undefined") {
        return;
      }

      if (window.location.pathname === `/chat/${conversationId}`) {
        return;
      }

      fetch(`/api/conversations/${conversationId}`, { method: "DELETE" }).catch(() => {});
    };
  }, [payload.conversation.id, isTemporaryToggled]);

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
        const bufferSnapshot = streamBuffer.getSnapshot();
        const hasLocalStreamState =
          Boolean(activeStreamMessageId) ||
          Boolean(bufferSnapshot.thinkingTarget) ||
          Boolean(bufferSnapshot.answerTarget) ||
          streamTimelineRef.current.length > 0;

        setMessages((current) => {
          const reconciliation = reconcileSnapshotMessages(
            current,
            result.messages,
            activeStreamMessageId,
            pendingLocalSubmissionsRef.current
          );
          const remappedAnchorMessageId = pendingAnchorMessageIdRef.current
            ? reconciliation.anchorMessageIdRemap.get(pendingAnchorMessageIdRef.current)
            : undefined;
          if (remappedAnchorMessageId) {
            pendingAnchorMessageIdRef.current = remappedAnchorMessageId;
          }
          pendingLocalSubmissionsRef.current = reconciliation.pendingLocalSubmissions;
          recordRenderKeyRemaps(reconciliation.anchorMessageIdRemap);
          return reconciliation.messages;
        });
        setConversationTitle(result.conversation.title);
        setTitleGenerationStatus(result.conversation.titleGenerationStatus);

        const activeMessage = activeStreamMessageId
          ? result.messages.find((message) => message.id === activeStreamMessageId)
          : null;

        if (activeMessage?.status === "streaming") {
          syncActiveStreamingMessageFromSnapshot(activeMessage);
        } else if (!activeStreamMessageId) {
          const streamingMsg = result.messages.find(
            (message) => message.role === "assistant" && message.status === "streaming"
          );
          if (streamingMsg) {
            syncActiveStreamingMessageFromSnapshot(streamingMsg);
          }
        }

        const shouldIgnoreInactiveResult =
          !result.conversation.isActive &&
          hasLocalStreamState &&
          (!activeMessage || activeMessage.status === "streaming");

        if (shouldIgnoreInactiveResult) {
          messageSyncTimeoutRef.current = window.setTimeout(() => {
            void syncConversation();
          }, wsConnectedRef.current ? 5000 : 1000);
          return;
        }

        const awaitingTurnStart = isSendingRef.current && !activeStreamMessageId;
        if (!awaitingTurnStart && (!result.conversation.isActive || (activeMessage && activeMessage.status !== "streaming"))) {
          setStreamMessageId(null);
          updateStreamTimeline([]);
          streamBuffer.reset();
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
      }, wsConnectedRef.current ? 5000 : 1000);
    };

    void syncConversation();

    return () => {
      cancelled = true;
      stopMessageSyncPolling();
    };
  }, [needsMessageSync, payload.conversation.id, streamBuffer, syncActiveStreamingMessageFromSnapshot, updateStreamTimeline]);

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

    pendingAnchorMessageIdRef.current = messageId;

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
      setIsConversationActive(true);
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

  async function retryAssistantMessage(messageId: string) {
    if (retryingMessageId) {
      return;
    }

    setError("");
    setRetryingMessageId(messageId);

    try {
      const response = await fetch(`/api/messages/${messageId}/retry`, {
        method: "POST"
      });

      if (!response.ok) {
        let message = "Message retry failed";

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
      setIsConversationActive(true);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Message retry failed"
      );
    } finally {
      setRetryingMessageId((current) => (current === messageId ? null : current));
    }
  }

  async function regenerateUserMessage(messageId: string) {
    if (regeneratingMessageId) {
      return;
    }

    if (streamMessageIdRef.current && !isStopPending) {
      stopActiveTurn();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    setError("");
    setRegeneratingMessageId(messageId);

    try {
      const response = await fetch(`/api/messages/${messageId}/regenerate`, {
        method: "POST"
      });

      if (!response.ok) {
        let message = "Message regeneration failed";

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
      setError(
        caughtError instanceof Error ? caughtError.message : "Message regeneration failed"
      );
    } finally {
      setRegeneratingMessageId((current) => (current === messageId ? null : current));
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

    } catch (caughtError) {
      setProviderProfileId(previousProviderProfileId);
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to update provider profile"
      );
    }
  }

  function dismissComposerKeyboardOnTouch() {
    if (shouldAutofocusTextInput()) {
      return;
    }
    inputRef.current?.blur();
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

      scrollToBottomRef.current?.();
      setError("");
      setInput("");
      dismissComposerKeyboardOnTouch();
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
    dismissComposerKeyboardOnTouch();
    setPendingAttachments([]);
    streamBuffer.reset();
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
    pendingAnchorMessageIdRef.current = optimisticUserMessage.id;

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

  const onUpdateUserMessageStable = useStableHandler(updateUserMessage);
  const onApproveMemoryProposalStable = useStableHandler(approveMemoryProposal);
  const onDismissMemoryProposalStable = useStableHandler(dismissMemoryProposal);
  const onForkAssistantMessageStable = useStableHandler(forkAssistantMessage);
  const onRetryAssistantMessageStable = useStableHandler(retryAssistantMessage);
  const onRegenerateUserMessageStable = useStableHandler(regenerateUserMessage);
  const onPreviewAttachmentStable = useStableHandler(previewController.openAttachmentPreview);

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
          <div className="hidden md:flex items-center gap-1">
            {canShare ? (
              <button
                type="button"
                className="h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/6 bg-white/[0.02] text-white/40 transition-colors duration-150 hover:border-white/10 hover:bg-white/[0.05] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 flex"
                onClick={openShareModal}
                aria-label="Share conversation"
                title="Share conversation"
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              className="h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)] transition-all duration-200 hover:opacity-90 hover:scale-[0.98] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 flex"
              onClick={async () => {
                try {
                  await deleteConversationIfStillEmpty(payload.conversation.id);
                  const res = await fetch("/api/conversations", { method: "POST" });
                  const data = (await res.json()) as { conversation: Conversation };
                  router.push(`/chat/${data.conversation.id}`);
                } catch {}
              }}
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <ConversationContainer>
        <StickToBottomBridge
          onAtBottomChange={setIsAtBottom}
          scrollToBottomRef={scrollToBottomRef}
        />
        <ConversationContent
          className="no-scrollbar overscroll-y-contain gap-2.5 px-2 pt-4 md:gap-4 md:px-8"
        >
          {(() => {
            if (initialMessageIdsRef.current === null) {
              initialMessageIdsRef.current = new Set(renderableMessages.map((m) => m.id));
            }
            return null;
          })()}
          {renderableMessages.map((message, index) => {
            const isStreamingMessage = message.id === streamMessageId;

            const wasPresentOnInit = initialMessageIdsRef.current!.has(message.id);
            const hasBeenAnimated = animatedMessageIdsRef.current.has(message.id);
            const shouldAnimate = hasBeenAnimated || (!wasPresentOnInit && message.role === "assistant");
            if (shouldAnimate && !hasBeenAnimated) {
              animatedMessageIdsRef.current.add(message.id);
            }

            return (
              <div
                key={renderKeyByMessageIdRef.current.get(message.id) ?? message.id}
                data-message-id={message.id}
                className={shouldAnimate ? "animate-slide-up" : ""}
                style={shouldAnimate ? { animationFillMode: "forwards" } : undefined}
              >
                {isStreamingMessage ? (
                  <StreamingMessage
                    buffer={streamBuffer}
                    message={message}
                    timeline={streamTimeline}
                    hasReceivedFirstToken={hasReceivedFirstToken}
                    compactionInProgress={compactionInProgress}
                    thinkingDuration={thinkingDuration}
                    onPreviewAttachment={onPreviewAttachmentStable}
                    onUpdateUserMessage={onUpdateUserMessageStable}
                    onApproveMemoryProposal={onApproveMemoryProposalStable}
                    onDismissMemoryProposal={onDismissMemoryProposalStable}
                    onForkAssistantMessage={onForkAssistantMessageStable}
                    onRetryAssistantMessage={onRetryAssistantMessageStable}
                  />
                ) : (
                  <MessageBubble
                    message={message}
                    onPreviewAttachment={onPreviewAttachmentStable}
                    onUpdateUserMessage={onUpdateUserMessageStable}
                    onApproveMemoryProposal={onApproveMemoryProposalStable}
                    onDismissMemoryProposal={onDismissMemoryProposalStable}
                    isUpdating={updatingMessageId === message.id}
                    onForkAssistantMessage={onForkAssistantMessageStable}
                    isForking={forkingMessageId === message.id}
                    onRetryAssistantMessage={onRetryAssistantMessageStable}
                    isRetrying={retryingMessageId === message.id}
                    onRegenerateUserMessage={index === lastUserMsgIndex ? onRegenerateUserMessageStable : undefined}
                    isRegenerating={regeneratingMessageId === message.id}
                  />
                )}
                {isStreamingMessage && isAgentIdle && hasReceivedFirstToken && (
                  <div className="animate-fade-in mt-[6px] inline-flex items-center overflow-hidden rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 md:ml-[42px]">
                    <TypingIndicator compact />
                  </div>
                )}
              </div>
            );
          })}
          {error ? (
            <div className="mx-auto mt-3 max-w-md rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300 text-center animate-slide-up">
              {error}
            </div>
          ) : null}
          <div ref={anchorSpacerRef} style={{ height: streamMessageId ? Math.max(80, composerAreaHeight + 40) : Math.max(24, composerAreaHeight) }} />
        </ConversationContent>
        <ConversationScrollButton />
      </ConversationContainer>

        <div ref={composerAreaRef} className="absolute inset-x-0 bottom-0 z-50 pointer-events-none">
         <div className="mx-auto w-full max-w-[980px] px-3 sm:px-4 md:px-8 pt-1 pb-composer-safe pointer-events-auto">
          <div ref={queueBannerRef}>
            <QueuedMessageBanner
              items={queuedMessages}
              onEdit={updateQueuedMessage}
              onDelete={deleteQueuedMessage}
              onSendNow={sendQueuedMessageNow}
            />
          </div>
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
            compactionLimit={compactionLimit}
            modelContextLimit={selectedProfile?.modelContextLimit ?? 128000}
            hasMessages={messages.length > 0}
            canStop={!!streamMessageId && !isStopPending}
            isStopPending={isStopPending}
            onStop={stopActiveTurn}
            speechPhase={speechSnapshot.phase}
            speechLevel={speechSnapshot.level}
            speechError={speechSnapshot.error}
            queueingEnabled={isConversationActive}
            isTemporary={isTemporaryToggled}
            showTemporaryToggle={messages.length === 0}
            onTemporaryChange={(value: boolean) => {
              setIsTemporaryToggled(value);
              fetch(`/api/conversations/${payload.conversation.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isTemporary: value })
              }).catch(() => {});
            }}
            isAtBottom={isAtBottom}
            onJumpToBottom={jumpToBottom}
            collapsibleToolbarOnMobile
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

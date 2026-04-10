"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatComposer } from "@/components/chat-composer";
import { MessageBubble } from "@/components/message-bubble";
import { clearChatBootstrap, readChatBootstrap } from "@/lib/chat-bootstrap";
import { useContextTokens } from "@/lib/context-tokens-context";
import {
  dispatchConversationActivityUpdated,
  dispatchConversationTitleUpdated
} from "@/lib/conversation-events";
import { useWebSocket } from "@/lib/ws-client";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { supportsImageInput } from "@/lib/model-capabilities";
import { shouldAutofocusTextInput } from "@/lib/utils";
import type {
  ChatStreamEvent,
  Conversation,
  Message,
  MessageAction,
  MessageAttachment,
  MessageTimelineItem,
  ProviderProfileSummary
} from "@/lib/types";

type ConversationPayload = {
  conversation: Conversation;
  messages: Message[];
  providerProfiles: ProviderProfileSummary[];
  defaultProviderProfileId: string;
  debug: {
    rawTurnCount: number;
    memoryNodeCount: number;
    latestCompactionAt: string | null;
  };
};

const AUTO_SCROLL_THRESHOLD_PX = 32;

function getActionSignature(action: Pick<MessageAction, "kind" | "label" | "detail" | "toolName">) {
  return [action.kind, action.label, action.detail, action.toolName ?? ""].join("\u0000");
}

function isNearQueueBottom(element: HTMLDivElement) {
  const distanceFromBottom =
    element.scrollHeight - element.clientHeight - element.scrollTop;
  return distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
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
  activeStreamMessageId: string | null
) {
  const sanitizedSnapshot = sanitizeMessages(snapshot);
  if (sanitizedSnapshot.length === 0) {
    return current.filter((message) => !isLegacyCompactionNotice(message));
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
  const newServerUserMessages = sanitizedSnapshot.filter(
    (m) => m.role === "user" && !currentNonLocalIds.has(m.id)
  );
  const pendingLocalUserMessages = current.filter(
    (m) => m.id.startsWith("local_") && m.role === "user" && !snapshotMessageIds.has(m.id)
  );

  const confirmCount = Math.min(pendingLocalUserMessages.length, newServerUserMessages.length);
  const confirmedLocalIds = new Set<string>();
  for (let i = 0; i < confirmCount; i++) {
    confirmedLocalIds.add(pendingLocalUserMessages[i].id);
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

  return [...merged, ...pendingLocalMessages];
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

export function ChatView({ payload }: { payload: ConversationPayload }) {
  const router = useRouter();
  const { getTokenUsage, setTokenUsage } = useContextTokens();
  const [messages, setMessages] = useState(() => sanitizeMessages(payload.messages));
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
  const compactionInProgressRef = useRef(false);
  const thinkingStartTimeRef = useRef<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number | undefined>(undefined);
  const [providerProfileId, setProviderProfileId] = useState(
    payload.conversation.providerProfileId ?? payload.defaultProviderProfileId
  );
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [personas, setPersonas] = useState<Array<{ id: string; name: string }>>([]);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const hasEmptyAssistantShell = messages.some(
    (message) =>
      message.role === "assistant" &&
      !message.content &&
      !(message.timeline?.length ?? 0) &&
      (message.status === "streaming" || message.status === "completed")
  );
  const needsMessageSync =
    isSending ||
    streamMessageId !== null ||
    messages.some((message) => message.role === "assistant" && message.status === "streaming") ||
    hasEmptyAssistantShell;
  const queueRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);
  const messagesRef = useRef(payload.messages);
  const streamAnswerTargetRef = useRef("");
  const streamThinkingTargetRef = useRef("");
  const streamMessageIdRef = useRef<string | null>(null);
  const streamTimelineRef = useRef<MessageTimelineItem[]>([]);
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null);
  const titlePollTimeoutRef = useRef<number | null>(null);
  const titlePollAttemptsRef = useRef(0);
  const messageSyncTimeoutRef = useRef<number | null>(null);
  const pendingLocalMessageIdsRef = useRef<string[]>([]);
  const pendingLocalSubmissionsRef = useRef<Array<{
    content: string;
    attachments: MessageAttachment[];
  }>>([]);
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

  useEffect(() => {
    setMessages(sanitizeMessages(payload.messages));
  }, [payload.messages]);

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

  useEffect(() => {
    setConversationTitle(payload.conversation.title);
  }, [payload.conversation.title]);

  useEffect(() => {
    setTitleGenerationStatus(payload.conversation.titleGenerationStatus);
  }, [payload.conversation.titleGenerationStatus]);

  useEffect(() => {
    setProviderProfileId(payload.conversation.providerProfileId ?? payload.defaultProviderProfileId);
  }, [payload.conversation.providerProfileId, payload.defaultProviderProfileId]);

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
  }, [payload.conversation.id]);

  useEffect(() => {
    if (!queueRef.current || !shouldAutoScrollRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      if (!queueRef.current || !shouldAutoScrollRef.current) return;
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
      const confirmedLocalId = pendingLocalMessageIdsRef.current.shift() ?? null;
      pendingLocalSubmissionsRef.current.shift();
      setStreamMessageId(event.messageId);
      dispatchConversationActivityUpdated({
        conversationId: payload.conversation.id,
        isActive: true
      });
      setMessages((current) => {
        const withoutLocal = confirmedLocalId
          ? current.filter((m) => m.id !== confirmedLocalId)
          : current;
        if (withoutLocal.some((message) => message.id === event.messageId)) {
          return withoutLocal;
        }

        return [
          ...withoutLocal,
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
      setStreamTimeline((prev) => {
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
      setStreamTimeline((prev) => updateStreamingAction(prev, event.action));
    }

    if (event.type === "done") {
      clearCompactionIndicator();
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
      setStreamTimeline([]);
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
      setStreamTimeline([]);
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
          if (streamMessageId) {
            const activeSnapshotMessage = (msg.messages as Message[]).find(
              (message) => message.id === streamMessageId
            );

            if (activeSnapshotMessage && activeSnapshotMessage.status !== "streaming") {
              setStreamMessageId(null);
              setStreamTimeline([]);
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
              setStreamTimeline(adoptedStream.timeline);
              setHasReceivedFirstToken(Boolean(answerFromTimeline || streamingMsg.thinkingContent));
              setIsSending(true);
            }
          }

          setMessages((current) =>
            reconcileSnapshotMessages(
              current,
              msg.messages as Message[],
              streamMessageId
            )
          );
          break;
        case "error":
          clearCompactionIndicator();
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
          setStreamTimeline([]);
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

    if (pendingLocalMessageIdsRef.current.length > 0) {
      const failedIds = new Set(pendingLocalMessageIdsRef.current);
      const latestSubmission = pendingLocalSubmissionsRef.current[pendingLocalSubmissionsRef.current.length - 1];

      setMessages((current) => current.filter((message) => !failedIds.has(message.id)));
      setInput((current) => current || latestSubmission?.content || "");
      setPendingAttachments((current) =>
        current.length > 0 ? current : (latestSubmission?.attachments ?? [])
      );
      pendingLocalMessageIdsRef.current = [];
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

        setMessages((current) =>
          reconcileSnapshotMessages(current, result.messages, activeStreamMessageId)
        );
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
          setStreamTimeline([]);
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
    !supportsImageInput(selectedProfile.model, selectedProfile.apiMode as "responses" | "chat_completions");

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
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content
            }
          : message
      )
    );

    try {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });

      if (!response.ok) {
        let message = "Unable to update message";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      const result = (await response.json()) as { message?: Message };

      if (result.message) {
        setMessages((current) =>
          current.map((message) => (message.id === result.message?.id ? result.message : message))
        );
      }

      router.refresh();
    } catch (caughtError) {
      setMessages((current) =>
        current.map((message) => (message.id === previousMessage.id ? previousMessage : message))
      );
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update message");
      throw caughtError;
    } finally {
      setUpdatingMessageId((current) => (current === messageId ? null : current));
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

    if ((!value && nextPendingAttachments.length === 0) || isSending || isUploadingAttachments) {
      return;
    }

    if (wsFailed) {
      setError(
        "Realtime chat connection is unavailable. Restart Eidon with the websocket server enabled."
      );
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
    setStreamTimeline([]);
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
      createdAt: new Date().toISOString()
    };
    pendingLocalMessageIdsRef.current.push(optimisticUserMessage.id);
    pendingLocalSubmissionsRef.current.push({
      content: value,
      attachments: nextPendingAttachments
    });
    setMessages((current) => [...current, optimisticUserMessage]);

    wsSend({
      type: "message",
      conversationId: payload.conversation.id,
      content: value,
      attachmentIds: nextPendingAttachments.map((attachment) => attachment.id),
      personaId: effectivePersonaId ?? undefined
    });

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
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 md:px-8"
        onScroll={() => {
          if (!queueRef.current) {
            return;
          }

          shouldAutoScrollRef.current = isNearQueueBottom(queueRef.current);
        }}
      >
        <div className="flex w-full flex-col gap-2.5 md:gap-4 px-2 md:px-0 pt-4 pb-[180px] md:pb-[200px]">
          {messages.map((message) => (
            <div
              key={message.id}
              className="animate-slide-up"
              style={{ animationFillMode: "forwards" }}
            >
              <MessageBubble
                message={message}
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
                isUpdating={updatingMessageId === message.id}
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

      <div className="fixed inset-x-0 bottom-0 z-10 pointer-events-none">
        <div className="mx-auto w-full px-4 md:px-8 pointer-events-auto max-w-[980px]">
          <ChatComposer
            input={input}
            onInputChange={setInput}
            onSubmit={submit}
            isSending={isSending}
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
          />
        </div>
      </div>
      </div>
    </div>
  );
}

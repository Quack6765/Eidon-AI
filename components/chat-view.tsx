"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { ChatComposer } from "@/components/chat-composer";
import { MessageBubble } from "@/components/message-bubble";
import { useWebSocket } from "@/lib/ws-client";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { supportsImageInput } from "@/lib/model-capabilities";
import { formatTimestamp, shouldAutofocusTextInput } from "@/lib/utils";
import type {
  ChatStreamEvent,
  Conversation,
  Message,
  MessageAction,
  MessageAttachment,
  MessageTimelineItem,
  ProviderProfileSummary,
  ToolExecutionMode
} from "@/lib/types";

type ConversationPayload = {
  conversation: Conversation;
  messages: Message[];
  toolExecutionMode: ToolExecutionMode;
  providerProfiles: ProviderProfileSummary[];
  defaultProviderProfileId: string;
  debug: {
    rawTurnCount: number;
    memoryNodeCount: number;
    latestCompactionAt: string | null;
  };
};

function appendStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  return [...timeline, { ...action, timelineKind: "action" }];
}

function updateStreamingAction(
  timeline: MessageTimelineItem[],
  action: MessageAction
): MessageTimelineItem[] {
  return timeline.map((item) =>
    item.timelineKind === "action" && item.id === action.id
      ? { ...action, timelineKind: "action" }
      : item
  );
}

export function ChatView({ payload }: { payload: ConversationPayload }) {
  const router = useRouter();
  const [messages, setMessages] = useState(payload.messages);
  const [conversationTitle, setConversationTitle] = useState(payload.conversation.title);
  const [titleGenerationStatus, setTitleGenerationStatus] = useState(
    payload.conversation.titleGenerationStatus
  );
  const [debug, setDebug] = useState(payload.debug);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamThinkingTarget, setStreamThinkingTarget] = useState("");
  const [streamThinkingDisplay, setStreamThinkingDisplay] = useState("");
  const [streamAnswerTarget, setStreamAnswerTarget] = useState("");
  const [streamAnswerDisplay, setStreamAnswerDisplay] = useState("");
  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const [streamTimeline, setStreamTimeline] = useState<MessageTimelineItem[]>([]);
  const [hasReceivedFirstToken, setHasReceivedFirstToken] = useState(false);
  const thinkingStartTimeRef = useRef<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number | undefined>(undefined);
  const [toolExecutionMode, setToolExecutionMode] = useState(payload.toolExecutionMode);
  const [providerProfileId, setProviderProfileId] = useState(
    payload.conversation.providerProfileId ?? payload.defaultProviderProfileId
  );
  const [showDebug, setShowDebug] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const queueRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);
  const messagesRef = useRef(payload.messages);
  const streamAnswerTargetRef = useRef("");
  const streamThinkingTargetRef = useRef("");
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null);
  const titlePollTimeoutRef = useRef<number | null>(null);
  const titlePollAttemptsRef = useRef(0);
  const submitRef = useRef<
    (nextInput?: string, nextPendingAttachments?: MessageAttachment[]) => Promise<void>
  >(async () => {});

  useEffect(() => {
    setMessages(payload.messages);
  }, [payload.messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setConversationTitle(payload.conversation.title);
  }, [payload.conversation.title]);

  useEffect(() => {
    setTitleGenerationStatus(payload.conversation.titleGenerationStatus);
  }, [payload.conversation.titleGenerationStatus]);

  useEffect(() => {
    setDebug(payload.debug);
  }, [payload.debug]);

  useEffect(() => {
    setToolExecutionMode(payload.toolExecutionMode);
  }, [payload.toolExecutionMode]);

  useEffect(() => {
    setProviderProfileId(payload.conversation.providerProfileId ?? payload.defaultProviderProfileId);
  }, [payload.conversation.providerProfileId, payload.defaultProviderProfileId]);

  useEffect(() => {
    if (!queueRef.current) {
      return;
    }

    queueRef.current.scrollTop = queueRef.current.scrollHeight;
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
    if (event.type === "message_start") {
      setStreamMessageId(event.messageId);
      setMessages((current) => [
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
      ]);
      return;
    }

    if (event.type === "usage") {
      return;
    }

    if (event.type === "thinking_delta") {
      setHasReceivedFirstToken(true);
      setStreamThinkingTarget((prev) => {
        const next = prev + event.text;
        streamThinkingTargetRef.current = next;
        return next;
      });
      if (!thinkingStartTimeRef.current) {
        thinkingStartTimeRef.current = Date.now();
      }
    }

    if (event.type === "answer_delta") {
      setHasReceivedFirstToken(true);
      setStreamAnswerTarget((prev) => {
        const next = prev + event.text;
        streamAnswerTargetRef.current = next;
        return next;
      });
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
      setStreamTimeline((prev) => appendStreamingAction(prev, event.action));
    }

    if (event.type === "action_complete" || event.type === "action_error") {
      setStreamTimeline((prev) => updateStreamingAction(prev, event.action));
    }

    if (event.type === "done") {
      const finalAnswer = streamAnswerTargetRef.current;
      const finalThinking = streamThinkingTargetRef.current;

      setMessages((current) =>
        current.map((m) =>
          m.id === event.messageId
            ? {
                ...m,
                content: finalAnswer,
                thinkingContent: finalThinking,
                status: "completed" as const
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
      setMessages((current) =>
        current.map((m) =>
          m.id === streamMessageId ? { ...m, status: "error" as const } : m
        )
      );
      setError(event.message);
      setStreamMessageId(null);
      setStreamTimeline([]);
      setIsSending(false);
    }
  }

  const { send: wsSend, subscribe: wsSubscribe, connected: wsConnected } = useWebSocket({
    onMessage(msg) {
      switch (msg.type) {
        case "snapshot":
          setMessages(msg.messages as Message[]);
          break;
        case "delta":
          handleDelta(msg.event as ChatStreamEvent);
          break;
      }
    }
  });

  useEffect(() => {
    wsSubscribe(payload.conversation.id);
  }, [payload.conversation.id, wsSubscribe]);

  function stopTitlePolling() {
    if (titlePollTimeoutRef.current !== null) {
      window.clearTimeout(titlePollTimeoutRef.current);
      titlePollTimeoutRef.current = null;
    }
  }

  async function pollConversationTitle() {
    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}`);

      if (!response.ok) {
        throw new Error("Unable to refresh conversation");
      }

      const result = (await response.json()) as {
        conversation: Conversation;
      };

      setConversationTitle(result.conversation.title);
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

  const latestCompactionLabel = useMemo(() => {
    if (!debug.latestCompactionAt) {
      return "No compaction yet";
    }

    return formatTimestamp(debug.latestCompactionAt);
  }, [debug.latestCompactionAt]);

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

  async function updateToolExecutionMode(nextToolExecutionMode: ToolExecutionMode) {
    const previousToolExecutionMode = toolExecutionMode;
    setError("");
    setToolExecutionMode(nextToolExecutionMode);

    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ toolExecutionMode: nextToolExecutionMode })
      });

      if (!response.ok) {
        let message = "Unable to update tool mode";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      router.refresh();
    } catch (caughtError) {
      setToolExecutionMode(previousToolExecutionMode);
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update tool mode");
    }
  }

  async function submit(
    nextInput = input,
    nextPendingAttachments = pendingAttachments
  ) {
    const value = nextInput.trim();

    if ((!value && nextPendingAttachments.length === 0) || isSending || isUploadingAttachments) {
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
    setMessages((current) => [...current, optimisticUserMessage]);

    wsSend({
      type: "message",
      conversationId: payload.conversation.id,
      content: value,
      attachmentIds: nextPendingAttachments.map((attachment) => attachment.id)
    });
  }

  submitRef.current = submit;

  return (
    <div
      data-testid="chat-view-root"
      className="relative flex min-h-0 flex-1 w-full flex-col bg-[var(--background)]"
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
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="flex items-center gap-1 mt-0.5 text-[11px] text-white/25 hover:text-white/40 transition-colors duration-200"
            >
              <span>{payload.debug.memoryNodeCount} memory nodes</span>
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showDebug ? "rotate-180" : ""}`} />
            </button>
            {showDebug && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-white/25 animate-fade-in">
                <span>{debug.rawTurnCount} raw turns</span>
                <span>Latest compaction: {latestCompactionLabel}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 md:px-8 scroll-smooth">
        <div className="flex w-full flex-col gap-2.5 md:gap-4 px-2 md:px-0 pt-4 pb-[140px] md:pb-[200px]">
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
                awaitingFirstToken={message.id === streamMessageId ? !hasReceivedFirstToken : false}
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

      <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none">
        <div className="h-24 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/90 to-transparent" />
        <div className="mx-auto w-full px-4 pb-4 md:px-8 md:pb-6 -mt-10 pointer-events-auto">
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
            toolExecutionMode={toolExecutionMode}
            onToolExecutionModeChange={updateToolExecutionMode}
            textareaRef={inputRef}
          />
        </div>
      </div>
    </div>
  );
}

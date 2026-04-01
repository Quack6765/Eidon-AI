"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { ChatComposer } from "@/components/chat-composer";
import { MessageBubble, StreamingPlaceholder } from "@/components/message-bubble";
import { consumeChatBootstrap } from "@/lib/chat-bootstrap";
import { dispatchConversationTitleUpdated } from "@/lib/conversation-events";
import { supportsImageInput } from "@/lib/model-capabilities";
import { formatTimestamp } from "@/lib/utils";
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

function parseSseChunk(buffer: string) {
  const events: ChatStreamEvent[] = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    const line = part
      .split("\n")
      .find((entry) => entry.startsWith("data: "));

    if (!line) {
      continue;
    }

    events.push(JSON.parse(line.slice(6)) as ChatStreamEvent);
  }

  return { events, remainder };
}

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
  const [streamStartedAt, setStreamStartedAt] = useState<string | null>(null);
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
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);
  const titlePollTimeoutRef = useRef<number | null>(null);
  const titlePollAttemptsRef = useRef(0);
  const submitRef = useRef<
    (nextInput?: string, nextPendingAttachments?: MessageAttachment[]) => Promise<void>
  >(async () => {});

  useEffect(() => {
    setMessages(payload.messages);
  }, [payload.messages]);

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
    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      const length = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(length, length);
    });

    return () => window.cancelAnimationFrame(handle);
  }, [payload.conversation.id]);

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
        dispatchConversationTitleUpdated({
          conversationId: result.conversation.id,
          title: result.conversation.title
        });

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

  async function syncConversationState() {
    const response = await fetch(`/api/conversations/${payload.conversation.id}`);

    if (!response.ok) {
      return;
    }

    const result = (await response.json()) as {
      conversation: Conversation;
      messages: Message[];
      debug: ConversationPayload["debug"];
    };

    setMessages(result.messages);
    setConversationTitle(result.conversation.title);
    setTitleGenerationStatus(result.conversation.titleGenerationStatus);
    setDebug(result.debug);
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
    const shouldPollConversationTitle =
      titleGenerationStatus === "pending" &&
      !messages.some((message) => message.role === "user");

    if ((!value && nextPendingAttachments.length === 0) || isSending || isUploadingAttachments) {
      return;
    }

    setError("");
    const optimisticUserMessage: Message = {
      id: `local_${crypto.randomUUID()}`,
      conversationId: payload.conversation.id,
      role: "user",
      content: value,
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0,
      systemKind: null,
      compactedAt: null,
      createdAt: new Date().toISOString(),
      attachments: nextPendingAttachments
    };

    setIsSending(true);
    setMessages((current) => [...current, optimisticUserMessage]);
    setInput("");
    setPendingAttachments([]);
    setStreamThinkingTarget("");
    setStreamThinkingDisplay("");
    setStreamAnswerTarget("");
    setStreamAnswerDisplay("");
    setStreamStartedAt(new Date().toISOString());
    setStreamTimeline([]);
    setHasReceivedFirstToken(false);
    thinkingStartTimeRef.current = null;
    setThinkingDuration(undefined);

    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: value,
          attachmentIds: nextPendingAttachments.map((attachment) => attachment.id)
        })
      });

      if (!response.ok || !response.body) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }

        let message = "Unable to send message";

        try {
          const failure = (await response.json()) as { error?: string };
          message = failure.error ?? message;
        } catch {}

        throw new Error(message);
      }

      if (shouldPollConversationTitle) {
        startTitlePolling();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let localThinking = "";
      let localAnswer = "";

      while (true) {
        const { done, value: chunk } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(chunk, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.remainder;

        parsed.events.forEach((event) => {
          if (event.type === "thinking_delta") {
            setHasReceivedFirstToken(true);
            localThinking += event.text;
            setStreamThinkingTarget(localThinking);
            if (!thinkingStartTimeRef.current) {
              thinkingStartTimeRef.current = Date.now();
            }
          }

          if (event.type === "answer_delta") {
            setHasReceivedFirstToken(true);
            localAnswer += event.text;
            setStreamAnswerTarget(localAnswer);
            if (thinkingStartTimeRef.current && !thinkingDuration) {
              const duration = (Date.now() - thinkingStartTimeRef.current) / 1000;
              setThinkingDuration(duration);
            }
          }

          if (event.type === "system_notice") {
            setMessages((current) => [
              ...current,
              {
                id: `notice_${crypto.randomUUID()}`,
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
            setStreamTimeline((current) => appendStreamingAction(current, event.action));
          }

          if (event.type === "action_complete" || event.type === "action_error") {
            setStreamTimeline((current) => updateStreamingAction(current, event.action));
          }

          if (event.type === "error") {
            setError(event.message);
          }
        });
      }

      await syncConversationState();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Chat failed");
    } finally {
      setStreamStartedAt(null);
      setStreamTimeline([]);
      setStreamThinkingTarget("");
      setStreamThinkingDisplay("");
      setStreamAnswerTarget("");
      setStreamAnswerDisplay("");
      setIsSending(false);
      setHasReceivedFirstToken(false);
    }
  }

  submitRef.current = submit;

  useEffect(() => {
    if (bootstrappedRef.current || messages.length > 0) {
      return;
    }

    const bootstrap = consumeChatBootstrap(payload.conversation.id);

    if (!bootstrap) {
      return;
    }

    bootstrappedRef.current = true;
    void submitRef.current(bootstrap.message, bootstrap.attachments);
  }, [messages.length, payload.conversation.id]);

  return (
    <div
      data-testid="chat-view-root"
      className="relative flex h-[100dvh] w-full flex-col bg-[var(--background)]"
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

      <div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 md:px-0 scroll-smooth">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pt-4 pb-[160px] md:pb-[200px]">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className="animate-slide-up"
              style={{ animationDelay: `${Math.min(index * 30, 300)}ms`, animationFillMode: "backwards" }}
            >
              <MessageBubble
                message={message}
                onUpdateUserMessage={updateUserMessage}
                isUpdating={updatingMessageId === message.id}
              />
            </div>
          ))}

          {streamStartedAt ? (
            <div className="animate-slide-up">
              <StreamingPlaceholder
                createdAt={streamStartedAt}
                thinking={streamThinkingDisplay}
                answer={streamAnswerDisplay}
                timeline={streamTimeline}
                awaitingFirstToken={!hasReceivedFirstToken}
                thinkingInProgress={Boolean(streamThinkingTarget) && !streamAnswerTarget}
                thinkingDuration={thinkingDuration}
                hasThinking={Boolean(streamThinkingTarget)}
              />
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300 text-center animate-slide-up">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none">
        <div className="h-24 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/90 to-transparent" />
        <div className="mx-auto w-full max-w-[980px] px-4 pb-4 md:pb-6 -mt-10 pointer-events-auto">
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

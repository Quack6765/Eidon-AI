"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ArrowUp, ChevronDown, Bot, Pen, Globe, Paperclip, LayoutGrid } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { MessageBubble, StreamingPlaceholder } from "@/components/message-bubble";
import { formatTimestamp } from "@/lib/utils";
import type { ChatStreamEvent, Conversation, Message, MessageAction, ToolExecutionMode } from "@/lib/types";

type ConversationPayload = {
  conversation: Conversation;
  messages: Message[];
  toolExecutionMode: ToolExecutionMode;
  providerProfiles: Array<{
    id: string;
    name: string;
    apiBaseUrl: string;
    model: string;
    apiMode: string;
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort: string;
    reasoningSummaryEnabled: boolean;
    modelContextLimit: number;
    compactionThreshold: number;
    freshTailCount: number;
    createdAt: string;
    updatedAt: string;
    hasApiKey: boolean;
  }>;
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

export function ChatView({ payload }: { payload: ConversationPayload }) {
  const router = useRouter();
  const [messages, setMessages] = useState(payload.messages);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamThinkingTarget, setStreamThinkingTarget] = useState("");
  const [streamThinkingDisplay, setStreamThinkingDisplay] = useState("");
  const [streamAnswerTarget, setStreamAnswerTarget] = useState("");
  const [streamAnswerDisplay, setStreamAnswerDisplay] = useState("");
  const [streamStartedAt, setStreamStartedAt] = useState<string | null>(null);
  const [streamActions, setStreamActions] = useState<MessageAction[]>([]);
  const [hasReceivedFirstToken, setHasReceivedFirstToken] = useState(false);
  const thinkingStartTimeRef = useRef<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number | undefined>(undefined);
  const [toolExecutionMode, setToolExecutionMode] = useState(payload.toolExecutionMode);
  const [providerProfileId, setProviderProfileId] = useState(
    payload.conversation.providerProfileId ?? payload.defaultProviderProfileId
  );
  const [showDebug, setShowDebug] = useState(false);
  const queueRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(payload.messages);
  }, [payload.messages]);

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
  }, [messages, streamThinkingDisplay, streamAnswerDisplay, streamActions]);

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
    if (!payload.debug.latestCompactionAt) {
      return "No compaction yet";
    }

    return formatTimestamp(payload.debug.latestCompactionAt);
  }, [payload.debug.latestCompactionAt]);

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

  async function submit() {
    const value = input.trim();

    if (!value || isSending) {
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
      createdAt: new Date().toISOString()
    };

    setIsSending(true);
    setMessages((current) => [...current, optimisticUserMessage]);
    setInput("");
    setStreamThinkingTarget("");
    setStreamThinkingDisplay("");
    setStreamAnswerTarget("");
    setStreamAnswerDisplay("");
    setStreamStartedAt(new Date().toISOString());
    setStreamActions([]);
    setHasReceivedFirstToken(false);
    thinkingStartTimeRef.current = null;
    setThinkingDuration(undefined);

    try {
      const response = await fetch(`/api/conversations/${payload.conversation.id}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: value })
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
            setStreamActions((current) => [...current, event.action]);
          }

          if (event.type === "action_complete" || event.type === "action_error") {
            setStreamActions((current) =>
              current.map((action) => (action.id === event.action.id ? event.action : action))
            );
          }

          if (event.type === "error") {
            setError(event.message);
          }
        });
      }

      if (localAnswer || localThinking) {
        setMessages((current) => [
          ...current,
          {
            id: `streamed_${crypto.randomUUID()}`,
            conversationId: payload.conversation.id,
            role: "assistant",
            content: localAnswer,
            thinkingContent: localThinking,
            status: "completed",
            estimatedTokens: 0,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString()
          }
        ]);
      }

      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Chat failed");
    } finally {
      setStreamStartedAt(null);
      setStreamActions([]);
      setStreamThinkingTarget("");
      setStreamThinkingDisplay("");
      setStreamAnswerTarget("");
      setStreamAnswerDisplay("");
      setIsSending(false);
      setHasReceivedFirstToken(false);
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col relative w-full bg-[var(--background)]">
      <div className="border-b border-white/4 px-4 py-3.5 md:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="font-medium text-[var(--text)] truncate text-sm">{payload.conversation.title}</div>
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="flex items-center gap-1 mt-0.5 text-[11px] text-white/25 hover:text-white/40 transition-colors duration-200"
            >
              <span>{payload.debug.memoryNodeCount} memory nodes</span>
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showDebug ? "rotate-180" : ""}`} />
            </button>
            {showDebug && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-white/25 animate-fade-in">
                <span>{payload.debug.rawTurnCount} raw turns</span>
                <span>Latest compaction: {latestCompactionLabel}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 md:px-0 scroll-smooth">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 pt-4 pb-[160px] md:pb-[200px]">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className="animate-slide-up"
              style={{ animationDelay: `${Math.min(index * 30, 300)}ms`, animationFillMode: "backwards" }}
            >
              <MessageBubble message={message} />
            </div>
          ))}

          {streamStartedAt ? (
            <div className="animate-slide-up">
              <StreamingPlaceholder
                createdAt={streamStartedAt}
                thinking={streamThinkingDisplay}
                answer={streamAnswerDisplay}
                actions={streamActions}
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
        <div className="mx-auto w-full max-w-[700px] px-4 pb-4 md:pb-6 -mt-10 pointer-events-auto">
          <div className="relative rounded-2xl border border-white/6 bg-[var(--panel)] p-2 shadow-[var(--shadow)] transition-all duration-300 focus-within:border-[var(--accent)]/20 focus-within:shadow-[var(--shadow),0_0_0_3px_var(--accent-soft)]">
            <div className="flex max-h-[200px] w-full items-end gap-1 pb-0.5 pr-1">
              <div className="flex-1 rounded-lg border border-white/8 bg-[#1f1f23]">
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
                  className="max-h-[200px] min-h-[44px] w-full resize-none border-0 box-border bg-transparent px-3 py-2 text-base text-[var(--text)] focus-visible:ring-0 focus:outline-none scrollbar-thin rounded-lg placeholder:text-white/25 caret-[var(--accent)]"
                  style={{ height: "auto" }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
              </div>

              <button
                onClick={() => void submit()}
                disabled={isSending || !input.trim()}
                className={`mb-0.5 mr-0.5 flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-300 shrink-0 ${
                  input.trim() && !isSending
                    ? "bg-[var(--accent)] text-white shadow-[0_0_12px_var(--accent-glow)] hover:shadow-[0_0_20px_var(--accent-glow)] active:scale-95"
                    : "bg-white/6 text-white/25"
                }`}
                aria-label="Send message"
              >
                {isSending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="flex items-center justify-between px-2 pt-1.5">
              <div className="flex items-center gap-1">
                <button
                  className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0"
                  aria-label="Attach files"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                
                <button
                  className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0"
                  aria-label="Web search"
                >
                  <Globe className="h-5 w-5" />
                </button>
                
                <div className="relative group">
                  <button
                    className="p-2 text-cyan-400/80 hover:text-cyan-400 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0 flex items-center gap-1"
                    aria-label="Select model"
                  >
                    <Bot className="h-5 w-5" />
                  </button>
                  <select
                    value={providerProfileId}
                    onChange={(event) => void updateProviderProfile(event.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    disabled={isSending || payload.providerProfiles.length === 0}
                  >
                    {payload.providerProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · {profile.model}
                      </option>
                    ))}
                  </select>
                </div>
                
                <button
                  className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0"
                  aria-label="Prompt templates"
                >
                  <LayoutGrid className="h-5 w-5" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <div className="relative group">
                  <button
                    className="p-2 text-white/25 hover:text-white/50 transition-colors duration-200 rounded-lg hover:bg-white/5 shrink-0 flex items-center gap-1"
                    aria-label="Tool mode"
                  >
                    <Pen className="h-5 w-5" />
                    <span className="text-[11px] text-white/40">
                      {toolExecutionMode === "read_only" ? "Read" : "Write"}
                    </span>
                  </button>
                  <select
                    value={toolExecutionMode}
                    onChange={(event) => void updateToolExecutionMode(event.target.value as ToolExecutionMode)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    disabled={isSending}
                  >
                    <option value="read_only">Read-Only</option>
                    <option value="read_write">Read/Write</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ArrowUp, Plus } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { MessageBubble, StreamingPlaceholder } from "@/components/message-bubble";
import { formatTimestamp } from "@/lib/utils";
import type { ChatStreamEvent, Conversation, Message } from "@/lib/types";

type ConversationPayload = {
  conversation: Conversation;
  messages: Message[];
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
  const [hasReceivedFirstToken, setHasReceivedFirstToken] = useState(false);
  const [providerProfileId, setProviderProfileId] = useState(
    payload.conversation.providerProfileId ?? payload.defaultProviderProfileId
  );
  const queueRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(payload.messages);
  }, [payload.messages]);

  useEffect(() => {
    setProviderProfileId(payload.conversation.providerProfileId ?? payload.defaultProviderProfileId);
  }, [payload.conversation.providerProfileId, payload.defaultProviderProfileId]);

  useEffect(() => {
    if (!queueRef.current) {
      return;
    }

    queueRef.current.scrollTop = queueRef.current.scrollHeight;
  }, [messages, streamThinkingDisplay, streamAnswerDisplay]);

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

  const activeProviderProfile = useMemo(
    () =>
      payload.providerProfiles.find((profile) => profile.id === providerProfileId) ??
      payload.providerProfiles.find((profile) => profile.id === payload.defaultProviderProfileId) ??
      null,
    [payload.defaultProviderProfileId, payload.providerProfiles, providerProfileId]
  );

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
    setHasReceivedFirstToken(false);

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
            setStreamThinkingTarget((current) => current + event.text);
          }

          if (event.type === "answer_delta") {
            setHasReceivedFirstToken(true);
            setStreamAnswerTarget((current) => current + event.text);
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

          if (event.type === "error") {
            setError(event.message);
          }
        });
      }

      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Chat failed");
    } finally {
      setStreamStartedAt(null);
      setStreamThinkingTarget("");
      setStreamThinkingDisplay("");
      setStreamAnswerTarget("");
      setStreamAnswerDisplay("");
      setIsSending(false);
      setHasReceivedFirstToken(false);
    }
  }

  // Calculate textarea height dynamically if needed, but Tailwind max-height handles it.
  return (
    <div className="flex h-[100dvh] flex-col relative w-full bg-[var(--background)]">
      <div className="border-b border-white/5 px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-medium text-[var(--text)]">{payload.conversation.title}</div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              <span>{payload.debug.memoryNodeCount} memory nodes</span>
              <span>Latest compaction: {latestCompactionLabel}</span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 md:items-end">
            <label className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[color:var(--accent)]">
              Conversation model
            </label>
            <select
              value={providerProfileId}
              onChange={(event) => void updateProviderProfile(event.target.value)}
              className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[var(--text)] md:w-[320px]"
              disabled={isSending || payload.providerProfiles.length === 0}
            >
              {payload.providerProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.model}
                </option>
              ))}
            </select>
            {activeProviderProfile ? (
              <p className="text-xs text-[var(--muted)]">
                {activeProviderProfile.apiMode} · {activeProviderProfile.apiBaseUrl}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 md:px-0 scroll-smooth">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pt-4 pb-[160px] md:pb-[200px]">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {streamStartedAt ? (
            <StreamingPlaceholder
              createdAt={streamStartedAt}
              thinking={streamThinkingDisplay}
              answer={streamAnswerDisplay}
              awaitingFirstToken={!hasReceivedFirstToken}
              thinkingInProgress={Boolean(streamThinkingTarget) && !streamAnswerTarget}
            />
          ) : null}
          
          {error ? <p className="mt-3 text-sm text-red-400 text-center">{error}</p> : null}
        </div>
      </div>

      {/* Footer / Input area - Fixed bottom */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[var(--background)] via-[var(--background)] to-transparent pt-6 md:pt-14 pb-4 md:pb-6 pointer-events-none">
        <div className="mx-auto w-full max-w-[700px] px-4 pointer-events-auto">
          <div className="relative rounded-[1.8rem] border border-white/10 bg-[#2f2f2f] p-2 shadow-2xl flex flex-col">
            <div className="flex max-h-[200px] w-full items-end pb-1 pr-1">
              <button 
                className="p-2 mb-1 ml-1 text-white/50 hover:text-white transition rounded-full hover:bg-white/10 shrink-0"
                aria-label="Add attachment"
              >
                 <Plus className="h-5 w-5" />
              </button>
              
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask anything"
                className="max-h-[200px] min-h-[44px] flex-1 resize-none border-0 box-border bg-transparent px-3 py-3 text-base text-[var(--text)] focus-visible:ring-0 focus:outline-none scrollbar-thin rounded-none placeholder:text-white/40"
                style={{ height: "auto" }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              
              <button 
                onClick={() => void submit()} 
                disabled={isSending || !input.trim()} 
                className={`mb-1 mr-1 flex h-8 w-8 items-center justify-center rounded-full transition shrink-0 shadow-sm ${
                  input.trim() && !isSending ? "bg-[var(--accent)] text-white hover:opacity-90" : "bg-white/10 text-white/40"
                }`}
                aria-label="Send message"
              >
                {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
              </button>
            </div>
            
            <div className="px-3 pb-1 text-center text-[11px] text-white/40">
              Hermes can make mistakes. Check important info.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

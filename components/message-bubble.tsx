"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { formatTimestamp } from "@/lib/utils";
import type { Message } from "@/lib/types";

export function MessageBubble({
  message,
  streamingThinking,
  streamingAnswer,
  awaitingFirstToken = false,
  thinkingInProgress = false
}: {
  message: Message;
  streamingThinking?: string;
  streamingAnswer?: string;
  awaitingFirstToken?: boolean;
  thinkingInProgress?: boolean;
}) {
  const content = streamingAnswer ?? message.content;
  const thinkingContent = streamingThinking ?? message.thinkingContent;
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const showThinkingShell = !awaitingFirstToken && (thinkingInProgress || Boolean(thinkingContent));
  const markdownPlugins = [remarkGfm, remarkBreaks];

  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-xl rounded-full border border-[color:var(--line)] bg-[var(--panel)] px-4 py-2 text-center text-xs tracking-[0.18em] text-[color:var(--muted)] uppercase">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="ml-auto w-full max-w-3xl flex justify-end">
        <div className="max-w-[75%] rounded-[1.4rem] bg-[#2f2f2f] px-5 py-3 text-[var(--text)]">
          <p className="whitespace-pre-wrap text-[15px] leading-7">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="flex gap-4">
        {/* Avatar */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-white/10 text-black font-semibold text-xs overflow-hidden mt-1">
          <img src="/chat-icon.png" alt="Assistant" className="h-full w-full object-cover" />
        </div>

        <div className="flex-1 space-y-3 pt-1 text-[15px] text-[var(--text)]">
          {showThinkingShell ? (
            <div className="mb-4 rounded-[1rem] border border-sky-300/10 bg-sky-300/5 px-4 py-3">
              <button
                type="button"
                onClick={() => setThinkingOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 text-left hover:opacity-80 transition"
              >
                <span className="flex items-center gap-2 text-[0.78rem] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                  {thinkingOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {thinkingInProgress ? (
                    <>
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      Thinking...
                    </>
                  ) : (
                    "Thought Process"
                  )}
                </span>
                <span className="text-[0.68rem] uppercase tracking-[0.18em] text-white/30">
                  {thinkingOpen ? "Hide" : "Show"}
                </span>
              </button>

              {thinkingOpen && thinkingContent ? (
                <div className="prose prose-invert mt-3 max-w-none prose-p:my-4 prose-p:leading-7 prose-pre:rounded-2xl prose-pre:border prose-pre:border-white/5 prose-pre:bg-black/20 prose-code:text-white/80 prose-li:my-1 prose-ul:my-4 prose-ol:my-4 text-white/70">
                  <ReactMarkdown remarkPlugins={markdownPlugins}>{thinkingContent}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          ) : null}

          {awaitingFirstToken ? (
            <div className="flex items-center gap-3 py-1">
              <div className="h-4 w-4 rounded-full bg-white/50 animate-pulse" />
            </div>
          ) : content ? (
            <div className="prose prose-invert max-w-none prose-p:my-2 prose-p:leading-7 prose-pre:rounded-xl prose-pre:bg-black/20 prose-pre:border prose-pre:border-white/5 prose-li:my-1 prose-ul:my-4 prose-ol:my-4 prose-a:text-blue-400">
              <ReactMarkdown remarkPlugins={markdownPlugins}>{content}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function StreamingPlaceholder({
  createdAt,
  thinking,
  answer,
  awaitingFirstToken,
  thinkingInProgress
}: {
  createdAt: string;
  thinking: string;
  answer: string;
  awaitingFirstToken: boolean;
  thinkingInProgress: boolean;
}) {
  return (
    <MessageBubble
      message={{
        id: "streaming",
        conversationId: "streaming",
        role: "assistant",
        content: "",
        thinkingContent: "",
        status: "streaming",
        estimatedTokens: 0,
        systemKind: null,
        compactedAt: null,
        createdAt
      }}
      streamingThinking={thinking}
      streamingAnswer={answer}
      awaitingFirstToken={awaitingFirstToken}
      thinkingInProgress={thinkingInProgress}
    />
  );
}

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import type { Message } from "@/lib/types";

function normalizeLineBreaks(text: string) {
  let result = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
  result = result.replace(/\n{3,}/g, (match) => {
    const extras = match.length - 2;
    return "\n\n" + ("\u00A0\n\n".repeat(extras));
  });
  return result;
}

const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks];

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2 px-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-white/40"
          style={{
            animation: "typing-dot 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`
          }}
        />
      ))}
    </div>
  );
}

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
  const rawContent = streamingAnswer ?? message.content;
  const rawThinking = streamingThinking ?? message.thinkingContent;
  const content = normalizeLineBreaks(rawContent);
  const thinkingContent = normalizeLineBreaks(rawThinking);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const showThinkingShell = !awaitingFirstToken && (thinkingInProgress || Boolean(thinkingContent));

  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-lg rounded-full border border-white/6 bg-white/[0.03] px-5 py-2 text-center text-[11px] tracking-[0.12em] text-white/40 uppercase">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[80%] md:max-w-[70%] rounded-2xl bg-[var(--accent-soft)] border border-[var(--accent)]/10 px-4 py-3 text-[var(--text)]">
          <p className="whitespace-pre-wrap text-[14.5px] leading-7">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex gap-3.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/6 text-[10px] font-bold text-white/60 overflow-hidden mt-1">
          <img src="/chat-icon.png" alt="" className="h-full w-full object-cover" />
        </div>

        <div className="flex-1 space-y-3 pt-0.5 text-[14.5px] text-[var(--text)]">
          {showThinkingShell ? (
            <div className="mb-3 rounded-xl border border-[var(--thinking)]/10 bg-[var(--thinking)]/[0.03] px-4 py-3 transition-all duration-300">
              <button
                type="button"
                onClick={() => setThinkingOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 text-left hover:opacity-80 transition-opacity duration-200"
              >
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--thinking)]/80">
                  {thinkingOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  {thinkingInProgress ? (
                    <>
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                      Thinking...
                    </>
                  ) : (
                    "Thought Process"
                  )}
                </span>
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/25">
                  {thinkingOpen ? "Hide" : "Show"}
                </span>
              </button>

              {thinkingOpen && thinkingContent ? (
                <div className="prose prose-invert mt-3 max-w-none prose-p:my-3 prose-p:leading-7 prose-pre:rounded-xl prose-pre:border prose-pre:border-white/4 prose-pre:bg-white/[0.02] prose-code:text-white/70 prose-li:my-0.5 prose-ul:my-3 prose-ol:my-3 text-white/55 text-sm">
                  <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          ) : null}

          {awaitingFirstToken ? (
            <TypingIndicator />
          ) : content ? (
            <div className="prose prose-invert max-w-none prose-p:my-2 prose-p:leading-7 prose-pre:rounded-xl prose-pre:bg-white/[0.02] prose-pre:border prose-pre:border-white/4 prose-li:my-0.5 prose-ul:my-3 prose-ol:my-3 prose-a:text-[var(--accent)] prose-strong:text-white/90">
              <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{content}</ReactMarkdown>
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

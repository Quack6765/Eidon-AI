"use client";

import React from "react";
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, LoaderCircle, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import type { Message, MessageAction } from "@/lib/types";
import { normalizeMarkdownLineBreaks } from "@/lib/utils";

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

function MessageActions({ actions }: { actions: MessageAction[] }) {
  if (!actions.length) {
    return null;
  }

  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <div
          key={action.id}
          className="flex items-center gap-2.5 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5 text-sm"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
            {action.status === "running" ? (
              <LoaderCircle className="h-3 w-3 animate-spin text-white/55" />
            ) : action.status === "completed" ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <X className="h-3 w-3 text-red-400" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-white/85">
              {action.label}
              {action.detail ? <span className="font-normal text-white/55">: {action.detail}</span> : null}
            </div>
            {action.status !== "running" && action.resultSummary ? (
              <p className="truncate text-xs text-white/35">{action.resultSummary}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const ASSISTANT_MAX_WIDTH = "max-w-[84%] md:max-w-[82%]";
const ASSISTANT_BUBBLE =
  "w-fit rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-[var(--text)] shadow-[0_8px_24px_rgba(0,0,0,0.28)]";

export function MessageBubble({
  message,
  streamingThinking,
  streamingAnswer,
  awaitingFirstToken = false,
  thinkingInProgress = false,
  thinkingDuration,
  hasThinking = false
}: {
  message: Message;
  streamingThinking?: string;
  streamingAnswer?: string;
  awaitingFirstToken?: boolean;
  thinkingInProgress?: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
}) {
  const rawContent = streamingAnswer ?? message.content;
  const rawThinking = streamingThinking ?? message.thinkingContent;
  const actions = message.actions ?? [];
  const content = normalizeMarkdownLineBreaks(rawContent);
  const thinkingContent = normalizeMarkdownLineBreaks(rawThinking);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const showThinkingShell = !awaitingFirstToken && (thinkingInProgress || hasThinking || Boolean(thinkingContent));

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
        <div className="max-w-[84%] md:max-w-[82%] rounded-2xl bg-[var(--accent-soft)] border border-[var(--accent)]/10 px-4 py-3 text-[var(--text)]">
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

        <div className="min-w-0 flex-1 pt-0.5 text-[14.5px] text-[var(--text)]">
          <div className="flex flex-col items-start gap-3">
            {actions.length ? (
              <div className={`w-full ${ASSISTANT_MAX_WIDTH}`}>
                <MessageActions actions={actions} />
              </div>
            ) : null}

            {showThinkingShell ? (
              <div className={`w-full ${ASSISTANT_MAX_WIDTH} rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5 transition-all duration-300`}>
                <button
                  type="button"
                  onClick={() => setThinkingOpen((current) => !current)}
                  className="flex w-full items-center gap-2 text-left hover:opacity-80 transition-opacity duration-200"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {thinkingInProgress ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-white/55" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-[13px] text-white/70">
                    <span className="font-medium">{thinkingInProgress ? "Thinking" : "Thought"}</span>
                    {thinkingInProgress ? (
                      <span className="text-white/40">...</span>
                    ) : thinkingDuration ? (
                      <span className="text-white/40">(in {thinkingDuration.toFixed(1)}s)</span>
                    ) : null}
                  </span>
                  <span className="ml-auto flex items-center">
                    {thinkingOpen ? (
                      <ChevronDown className="h-4 w-4 text-white/40" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-white/40" />
                    )}
                  </span>
                </button>

                {thinkingOpen && thinkingContent ? (
                  <div className="markdown-body mt-2 text-sm text-white/55">
                    <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
                  </div>
                ) : null}
              </div>
            ) : null}

            {awaitingFirstToken ? (
              <div className={`${ASSISTANT_MAX_WIDTH} ${ASSISTANT_BUBBLE}`} data-testid="assistant-message-bubble">
                <TypingIndicator />
              </div>
            ) : content ? (
              <div className={`${ASSISTANT_MAX_WIDTH} ${ASSISTANT_BUBBLE}`} data-testid="assistant-message-bubble">
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{content}</ReactMarkdown>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function StreamingPlaceholder({
  createdAt,
  thinking,
  answer,
  actions,
  awaitingFirstToken,
  thinkingInProgress,
  thinkingDuration,
  hasThinking = false
}: {
  createdAt: string;
  thinking: string;
  answer: string;
  actions: MessageAction[];
  awaitingFirstToken: boolean;
  thinkingInProgress: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
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
        createdAt,
        actions
      }}
      streamingThinking={thinking}
      streamingAnswer={answer}
      awaitingFirstToken={awaitingFirstToken}
      thinkingInProgress={thinkingInProgress}
      thinkingDuration={thinkingDuration}
      hasThinking={hasThinking}
    />
  );
}

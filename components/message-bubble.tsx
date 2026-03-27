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
      <div className="mx-auto max-w-xl rounded-full border border-[color:var(--line)] bg-white/[0.04] px-4 py-2 text-center text-xs tracking-[0.18em] text-[color:var(--muted)] uppercase">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-3xl rounded-[1.8rem] border border-white/10 bg-white/[0.04] px-5 py-4">
        <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[color:var(--muted)]">
          You · {formatTimestamp(message.createdAt)}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--text)]">{content}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-3">
      <div className="rounded-[2rem] border border-[color:var(--line)] bg-black/10 px-5 py-4">
        <p className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[color:var(--accent)]">
          Hermes · {formatTimestamp(message.createdAt)}
        </p>

        {showThinkingShell ? (
          <div className="mb-4 rounded-[1.5rem] border border-sky-300/20 bg-sky-300/8 px-4 py-3">
            <button
              type="button"
              onClick={() => setThinkingOpen((current) => !current)}
              className="flex w-full items-center justify-between gap-3 text-left text-sky-100"
            >
              <span className="flex items-center gap-2 text-[0.78rem] font-semibold uppercase tracking-[0.22em] text-sky-200">
                {thinkingOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {thinkingInProgress ? (
                  <>
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Thinking...
                  </>
                ) : (
                  "Thinking"
                )}
              </span>
              <span className="text-[0.68rem] uppercase tracking-[0.18em] text-sky-100/60">
                {thinkingOpen ? "Hide" : "Show"}
              </span>
            </button>

            {thinkingOpen && thinkingContent ? (
              <div className="prose prose-invert mt-3 max-w-none prose-p:my-4 prose-p:leading-7 prose-pre:rounded-2xl prose-pre:border prose-pre:border-sky-200/15 prose-pre:bg-[#0f1a24] prose-code:text-sky-100 prose-li:my-1 prose-ul:my-4 prose-ol:my-4">
                <ReactMarkdown remarkPlugins={markdownPlugins}>{thinkingContent}</ReactMarkdown>
              </div>
            ) : null}
          </div>
        ) : null}

        {awaitingFirstToken ? (
          <div className="flex items-center gap-3 text-sm text-[color:var(--muted)]">
            <LoaderCircle className="h-4 w-4 animate-spin text-[color:var(--accent)]" />
            Loading...
          </div>
        ) : content ? (
          <div className="prose prose-invert max-w-none prose-p:my-4 prose-p:leading-7 prose-pre:rounded-2xl prose-pre:border prose-pre:border-white/10 prose-pre:bg-[#10141b] prose-code:text-[color:var(--accent)] prose-li:my-1 prose-ul:my-4 prose-ol:my-4">
            <ReactMarkdown remarkPlugins={markdownPlugins}>{content}</ReactMarkdown>
          </div>
        ) : null}
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

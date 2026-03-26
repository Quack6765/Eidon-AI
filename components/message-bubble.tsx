import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn, formatTimestamp } from "@/lib/utils";
import type { Message } from "@/lib/types";

export function MessageBubble({
  message,
  streamingThinking,
  streamingAnswer
}: {
  message: Message;
  streamingThinking?: string;
  streamingAnswer?: string;
}) {
  const content = streamingAnswer ?? message.content;
  const thinkingContent = streamingThinking ?? message.thinkingContent;

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

        {thinkingContent ? (
          <div className="mb-4 rounded-[1.5rem] border border-sky-300/20 bg-sky-300/8 px-4 py-3">
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-sky-200">
              Thinking
            </p>
            <p className="whitespace-pre-wrap text-sm leading-7 text-sky-100/90">
              {thinkingContent}
            </p>
          </div>
        ) : null}

        <div className="prose prose-invert max-w-none prose-p:leading-7 prose-pre:rounded-2xl prose-pre:border prose-pre:border-white/10 prose-pre:bg-[#10141b] prose-code:text-[color:var(--accent)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || " "}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export function StreamingPlaceholder({
  createdAt,
  thinking,
  answer
}: {
  createdAt: string;
  thinking: string;
  answer: string;
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
    />
  );
}

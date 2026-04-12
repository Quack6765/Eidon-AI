"use client";

import React, { useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Copy, FileText, GitFork, LoaderCircle, Pencil, Square, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { CompactionIndicator } from "@/components/compaction-indicator";
import { Textarea } from "@/components/ui/textarea";
import type {
  Message,
  MessageAction,
  MessageAttachment,
  MessageTimelineItem
} from "@/lib/types";
import { normalizeMarkdownLineBreaks } from "@/lib/utils";

const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks];
const COPY_RESET_DELAY_MS = 1600;

function TypingIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex items-center gap-1" : "flex items-center gap-1.5 px-1 py-2"}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="typing-dot h-1.5 w-1.5 rounded-full bg-white/40"
          style={{
            ["--typing-dot-lift" as string]: compact ? "2px" : "6px",
            animation: "typing-dot 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`
          }}
        />
      ))}
    </div>
  );
}

function CollapsibleActionRow({
  action,
  isOpen,
  onToggle
}: {
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isMemoryAction = action.kind === "create_memory" || action.kind === "update_memory" || action.kind === "delete_memory";

  const statusIcon = action.status === "running"
    ? <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />
    : action.status === "completed"
      ? <Check className="h-2.5 w-2.5 text-emerald-400" />
      : action.status === "stopped"
        ? <Square className="h-2.5 w-2.5 text-red-400 fill-current" />
        : <X className="h-2.5 w-2.5 text-red-400" />;

  if (action.status === "running") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-xs">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {isMemoryAction ? <Brain className="h-2.5 w-2.5 text-violet-400" /> : statusIcon}
        </span>
        <span className="text-[12px] font-medium text-white/55">{action.label}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.015] transition-all duration-300">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition hover:opacity-80"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {isMemoryAction ? <Brain className="h-3 w-3 text-violet-400" /> : statusIcon}
        </span>
        <span className="text-[12px] font-medium text-white/85">{action.label}</span>
        <span className="ml-auto flex items-center">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
        </span>
      </button>
      {isOpen && (action.detail || action.resultSummary) ? (
        <div className="px-2.5 pb-2">
          {action.detail ? (
            <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-[11px] leading-5 text-white/45 whitespace-pre-wrap break-words font-mono">{action.detail}</pre>
          ) : null}
          {action.resultSummary ? (
            <p className="mt-1.5 text-[11px] text-white/35 break-words">{action.resultSummary}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const ASSISTANT_MAX_WIDTH = "max-w-[96%] md:max-w-[95%]";
const ASSISTANT_BUBBLE =
  "w-fit rounded-2xl border border-white/8 bg-white/[0.03] px-2.5 py-2 md:px-4 md:py-3 text-[var(--text)] shadow-[0_8px_24px_rgba(0,0,0,0.28)]";
const ASSISTANT_LOADING_SHELL =
  "mt-[6px] inline-flex items-center overflow-hidden rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1";

function getActionSignature(action: Pick<MessageAction, "kind" | "label" | "detail" | "toolName">) {
  return [action.kind, action.label, action.detail, action.toolName ?? ""].join("\u0000");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPlainTextHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

async function writeMessageToClipboard(input: { html: string; text: string }) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard unavailable");
  }

  if (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard.write === "function" &&
    input.html
  ) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([input.text], { type: "text/plain" }),
        "text/html": new Blob([input.html], { type: "text/html" })
      })
    ]);
    return;
  }

  await navigator.clipboard.writeText(input.text);
}

function ActionButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-white/6 bg-white/[0.02] text-white/35 transition hover:border-white/10 hover:bg-white/[0.05] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function AttachmentTile({ attachment, compact = false }: { attachment: MessageAttachment; compact?: boolean }) {
  const href = `/api/attachments/${attachment.id}`;

  if (attachment.kind === "image") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`overflow-hidden rounded-xl border border-white/10 bg-black/20 ${compact ? "w-16" : "w-28"}`}
      >
        <img
          src={href}
          alt={attachment.filename}
          className={`w-full object-cover ${compact ? "h-16" : "h-28"}`}
        />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-left"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/75">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-white">{attachment.filename}</span>
        <span className="block truncate text-xs text-white/60">{attachment.mimeType}</span>
      </span>
    </a>
  );
}

function MessageAttachments({
  attachments,
  compact = false
}: {
  attachments: MessageAttachment[];
  compact?: boolean;
}) {
  if (!attachments.length) {
    return null;
  }

  const images = attachments.filter((attachment) => attachment.kind === "image");
  const files = attachments.filter((attachment) => attachment.kind === "text");

  return (
    <div className="space-y-2.5">
      {images.length ? (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) => (
            <AttachmentTile key={attachment.id} attachment={attachment} compact={compact} />
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="space-y-2">
          {files.map((attachment) => (
            <AttachmentTile key={attachment.id} attachment={attachment} compact={compact} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MessageBubble({
  message,
  streamingTimeline,
  streamingThinking,
  streamingAnswer,
  awaitingFirstToken = false,
  compactionInProgress = false,
  thinkingInProgress = false,
  thinkingDuration,
  hasThinking = false,
  onUpdateUserMessage,
  isUpdating = false,
  onForkAssistantMessage,
  isForking = false
}: {
  message: Message;
  streamingTimeline?: MessageTimelineItem[];
  streamingThinking?: string;
  streamingAnswer?: string;
  awaitingFirstToken?: boolean;
  compactionInProgress?: boolean;
  thinkingInProgress?: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
  onUpdateUserMessage?: (messageId: string, content: string) => Promise<void>;
  isUpdating?: boolean;
  onForkAssistantMessage?: (messageId: string) => void;
  isForking?: boolean;
}) {
  const rawContent = streamingAnswer ?? message.content;
  const rawThinking = streamingThinking ?? message.thinkingContent;
  const actions = message.actions ?? [];
  const liveTimeline = streamingTimeline ?? message.timeline;
  const content = normalizeMarkdownLineBreaks(rawContent);
  const thinkingContent = normalizeMarkdownLineBreaks(rawThinking);
  const timeline = liveTimeline ?? actions.map((action) => ({
    ...action,
    timelineKind: "action" as const
  }));
  const assistantBlocks: MessageTimelineItem[] = [];
  let bufferedText = "";

  function appendBufferedText() {
    if (!bufferedText) {
      return;
    }

    assistantBlocks.push({
      id: `text_${message.id}_${assistantBlocks.length}`,
      timelineKind: "text",
      sortOrder: assistantBlocks.length,
      createdAt: message.createdAt,
      content: bufferedText
    });
    bufferedText = "";
  }

  function mergeText(current: string, next: string) {
    if (!current) {
      return next;
    }

    if (next.startsWith(current)) {
      return next;
    }

    if (current.endsWith(next)) {
      return current;
    }

    return `${current}${next}`;
  }

  timeline.forEach((item) => {
    if (item.timelineKind === "action") {
      appendBufferedText();
      const previousBlock = assistantBlocks[assistantBlocks.length - 1];

      if (
        previousBlock?.timelineKind === "action" &&
        getActionSignature(previousBlock) === getActionSignature(item)
      ) {
        assistantBlocks[assistantBlocks.length - 1] = item;
        return;
      }

      assistantBlocks.push(item);
      return;
    }

    bufferedText = mergeText(bufferedText, item.content);
  });

  appendBufferedText();

  const consumedText = assistantBlocks
    .filter(
      (item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> =>
        item.timelineKind === "text"
    )
    .map((item) => item.content)
    .join("");

  if (rawContent && rawContent.length > consumedText.length) {
    assistantBlocks.push({
      id: `content_${message.id}_remaining`,
      timelineKind: "text",
      sortOrder: assistantBlocks.length,
      createdAt: message.createdAt,
      content: rawContent.slice(consumedText.length)
    });
  }

  const assistantText = assistantBlocks
    .filter(
      (item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> =>
        item.timelineKind === "text"
    )
    .map((item) => item.content)
    .join("");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [toolOpenItems, setToolOpenItems] = useState<Record<string, boolean>>({});

  function toggleToolItem(id: string) {
    setToolOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const copyResetHandle = useRef<number | null>(null);
  const showThinkingShell = !awaitingFirstToken && (thinkingInProgress || hasThinking || Boolean(thinkingContent));
  const showUserBubbleActions = Boolean(content) && !awaitingFirstToken;
  const showAssistantBubbleActions = Boolean(assistantText) && !awaitingFirstToken;

  useEffect(() => {
    setDraft(message.content);
  }, [message.content]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    editRef.current?.focus({ preventScroll: true });
    const length = editRef.current?.value.length ?? 0;
    editRef.current?.setSelectionRange(length, length);
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (copyResetHandle.current) {
        window.clearTimeout(copyResetHandle.current);
      }
    };
  }, []);

  function setCopyFeedback(nextState: "copied" | "error") {
    setCopyState(nextState);

    if (copyResetHandle.current) {
      window.clearTimeout(copyResetHandle.current);
    }

    copyResetHandle.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetHandle.current = null;
    }, COPY_RESET_DELAY_MS);
  }

  async function handleCopy() {
    try {
      const html =
        message.role === "assistant"
          ? formatPlainTextHtml(assistantText)
          : formatPlainTextHtml(message.content);
      const text =
        message.role === "assistant"
          ? assistantText
          : message.content;

      await writeMessageToClipboard({ html, text });
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("error");
    }
  }

  async function handleSaveEdit() {
    const nextContent = draft.trim();

    if (!nextContent || !onUpdateUserMessage) {
      return;
    }

    if (nextContent === message.content.trim()) {
      setDraft(message.content);
      setIsEditing(false);
      return;
    }

    await onUpdateUserMessage(message.id, nextContent);
    setIsEditing(false);
  }

  function handleCancelEdit() {
    setDraft(message.content);
    setIsEditing(false);
  }

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
        <div className="group flex max-w-[96%] flex-col items-end md:max-w-[95%]">
          <div className="w-full rounded-2xl border border-[var(--accent)]/10 bg-[var(--accent-soft)] px-4 py-3 text-[var(--text)]">
            {isEditing ? (
              <Textarea
                ref={editRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-[88px] border-0 bg-transparent px-0 py-0 text-[14.5px] leading-7 text-[var(--text)] focus-visible:ring-0"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handleSaveEdit();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    handleCancelEdit();
                  }
                }}
              />
            ) : content ? (
              <div ref={contentRef}>
                <p className="whitespace-pre-wrap text-[14.5px] leading-7">{content}</p>
              </div>
            ) : null}
            {message.attachments?.length ? (
              <div className={content || isEditing ? "mt-3" : ""}>
                <MessageAttachments attachments={message.attachments} compact />
              </div>
            ) : null}
          </div>

          {showUserBubbleActions ? (
            <div className="mt-2 flex items-center gap-1 opacity-100 transition md:pointer-events-none md:translate-y-1 md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
              <ActionButton
                label={copyState === "copied" ? "Copied" : "Copy message"}
                onClick={() => void handleCopy()}
              >
                {copyState === "copied" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : copyState === "error" ? (
                  <X className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </ActionButton>

              {isEditing ? (
                <>
                  <ActionButton
                    label="Save edit"
                    onClick={() => void handleSaveEdit()}
                    disabled={isUpdating || !draft.trim()}
                  >
                    {isUpdating ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </ActionButton>
                  <ActionButton label="Cancel edit" onClick={handleCancelEdit} disabled={isUpdating}>
                    <X className="h-3.5 w-3.5" />
                  </ActionButton>
                </>
              ) : (
                <ActionButton label="Edit message" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </ActionButton>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex gap-3.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/6 text-[10px] font-bold text-white/60 overflow-hidden mt-1">
          <img src="/agent-icon.png" alt="" width={28} height={28} className="h-full w-full object-cover" />
        </div>

        <div className="min-w-0 flex-1 pt-0.5 text-[14.5px] text-[var(--text)]">
          <div className="flex flex-col items-start gap-3">
            {showThinkingShell ? (
              <div
                data-testid="assistant-thinking-shell"
                className={`w-fit rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 transition-all duration-300`}
              >
                <button
                  type="button"
                  onClick={() => setThinkingOpen((current) => !current)}
                  className="flex w-full items-center gap-1.5 text-left transition hover:opacity-80"
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {thinkingInProgress ? (
                      <LoaderCircle className="h-3 w-3 animate-spin text-white/45" />
                    ) : (
                      <Check className="h-3 w-3 text-emerald-400/80" />
                    )}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-white/50">
                    <span className="font-medium">{thinkingInProgress ? "Thinking" : "Thought"}</span>
                    {thinkingInProgress ? (
                      <span className="text-white/30">...</span>
                    ) : thinkingDuration ? (
                      <span className="text-white/30">({thinkingDuration.toFixed(1)}s)</span>
                    ) : null}
                  </span>
                  <span className="ml-auto flex items-center">
                    {thinkingOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-white/30" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-white/30" />
                    )}
                  </span>
                </button>

                {thinkingOpen && thinkingContent ? (
                  <div className="markdown-body thinking-markdown-body mt-1.5">
                    <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
                  </div>
                ) : null}
              </div>
            ) : null}

            {awaitingFirstToken ? (
              compactionInProgress ? (
                <CompactionIndicator />
              ) : (
                <div
                  className={ASSISTANT_LOADING_SHELL}
                  data-testid="assistant-loading-shell"
                >
                  <TypingIndicator compact />
                </div>
              )
            ) : assistantBlocks.length || content ? (
              <div className="group flex flex-col items-start">
                <div ref={contentRef} className={`flex w-full ${ASSISTANT_MAX_WIDTH} flex-col gap-3`}>
                  {assistantBlocks.map((item) => {
                    if (item.timelineKind === "action") {
                      return (
                        <div key={item.id} data-testid="assistant-actions-shell">
                          <CollapsibleActionRow
                            action={item}
                            isOpen={toolOpenItems[item.id] ?? false}
                            onToggle={() => toggleToolItem(item.id)}
                          />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={item.id}
                        className={ASSISTANT_BUBBLE}
                        data-testid="assistant-message-bubble"
                      >
                        <div className="markdown-body">
                          <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{item.content}</ReactMarkdown>
                        </div>
                      </div>
                    );
                  })}
                  {message.status === "stopped" ? (
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-red-400/12 bg-red-400/8 px-2 py-1 text-[11px] text-red-200/85">
                      <Square className="h-2.5 w-2.5 fill-current" />
                      <span>Stopped</span>
                    </div>
                  ) : null}
                </div>

                {showAssistantBubbleActions ? (
                  <div className="mt-2 flex items-center gap-1 opacity-100 transition md:pointer-events-none md:translate-y-1 md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
                    <ActionButton
                      label={copyState === "copied" ? "Copied" : "Copy message"}
                      onClick={() => void handleCopy()}
                    >
                      {copyState === "copied" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : copyState === "error" ? (
                        <X className="h-3.5 w-3.5 text-red-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </ActionButton>
                    {onForkAssistantMessage && message.status === "completed" ? (
                      <ActionButton
                        label="Fork conversation from message"
                        onClick={() => onForkAssistantMessage(message.id)}
                        disabled={isForking}
                      >
                        {isForking ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <GitFork className="h-3.5 w-3.5" />
                        )}
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
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
  timeline,
  awaitingFirstToken,
  compactionInProgress = false,
  thinkingInProgress,
  thinkingDuration,
  hasThinking = false,
  onForkAssistantMessage
}: {
  createdAt: string;
  thinking: string;
  answer: string;
  timeline: MessageTimelineItem[];
  awaitingFirstToken: boolean;
  compactionInProgress?: boolean;
  thinkingInProgress: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
  onForkAssistantMessage?: (messageId: string) => void;
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
        timeline
      }}
      streamingThinking={thinking}
      streamingAnswer={answer}
      awaitingFirstToken={awaitingFirstToken}
      compactionInProgress={compactionInProgress}
      thinkingInProgress={thinkingInProgress}
      thinkingDuration={thinkingDuration}
      hasThinking={hasThinking}
      onForkAssistantMessage={onForkAssistantMessage}
    />
  );
}

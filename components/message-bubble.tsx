"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Copy, GitFork, LoaderCircle, Pencil, RefreshCw, Square, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { MarkdownErrorBoundary } from "@/components/markdown-error-boundary";
import {
  AttachmentPreviewModal,
  useAttachmentPreviewController
} from "@/components/attachment-preview-modal";
import { CompactionIndicator } from "@/components/compaction-indicator";
import { parseAnsiText } from "@/lib/ansi";
import { stripAttachmentStyleImageMarkdown } from "@/lib/assistant-image-markdown";
import { useStreamdownPlugins } from "@/lib/streamdown-plugins";
import { writeRichTextToClipboard } from "@/lib/clipboard";
import {
  isMemoryProposalAction,
  getMemoryProposalHeading,
  MemoryProposalCard
} from "@/components/memory-proposal-card";
import {
  AttachmentTile,
  MessageAttachments,
  AssistantInlineImageAttachments
} from "@/components/message-attachments";
import type {
  MemoryCategory,
  Message as MessageType,
  MessageAction as MessageActionType,
  MessageAttachment,
  MessageTimelineItem
} from "@/lib/types";
import { normalizeLineBreaks } from "@/lib/text-utils";
import { Textarea } from "@/components/ui/textarea";
import {
  Message,
  MessageContent,
  MessageAction
} from "@/components/ai-elements/message";

const COPY_RESET_DELAY_MS = 1600;


function getAnsiForegroundClassName(foregroundColor: ReturnType<typeof parseAnsiText>[number]["foregroundColor"]) {
  switch (foregroundColor) {
    case "black":
      return "text-white/55";
    case "red":
      return "text-red-300";
    case "green":
      return "text-emerald-300";
    case "yellow":
      return "text-amber-300";
    case "blue":
      return "text-sky-300";
    case "magenta":
      return "text-fuchsia-300";
    case "cyan":
      return "text-cyan-300";
    case "white":
      return "text-white/90";
    default:
      return null;
  }
}

function AnsiText({
  text,
  defaultTextClassName
}: {
  text: string;
  defaultTextClassName: string;
}) {
  const segments = useMemo(() => parseAnsiText(text), [text]);

  return (
    <>
      {segments.map((segment, index) => {
        const segmentClassName = [
          getAnsiForegroundClassName(segment.foregroundColor) ?? defaultTextClassName,
          segment.bold ? "font-semibold" : null
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <span key={`${index}:${segment.text.length}`} className={segmentClassName}>
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

const AssistantMarkdown = React.memo(function AssistantMarkdown({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const plugins = useStreamdownPlugins(content);
  const fallback = (
    <pre className="whitespace-pre-wrap break-words text-sm">{content}</pre>
  );
  return (
    <MarkdownErrorBoundary fallback={fallback} resetKey={content}>
      <Streamdown
        plugins={plugins}
        caret={isStreaming ? "block" : undefined}
        isAnimating={isStreaming}
      >
        {content}
      </Streamdown>
    </MarkdownErrorBoundary>
  );
});

export function TypingIndicator({ compact = false }: { compact?: boolean }) {
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
      <div className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-xs">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {isMemoryAction ? <Brain className="h-2.5 w-2.5 text-violet-400" /> : statusIcon}
        </span>
        <span className="whitespace-nowrap text-[12px] font-medium text-white/55">{action.label}</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex w-fit max-w-full flex-col rounded-lg border border-white/5 bg-white/[0.015] transition-all duration-300 ${
        isOpen ? "w-full" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-left transition hover:opacity-80 ${isOpen ? "w-full" : "w-fit min-w-0"}`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {isMemoryAction ? <Brain className="h-3 w-3 text-violet-400" /> : statusIcon}
        </span>
        <span className="whitespace-nowrap text-[12px] font-medium text-white/85">{action.label}</span>
        <span className="ml-auto flex items-center">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
        </span>
      </button>
      {isOpen && (action.detail || action.resultSummary) ? (
        <div
          className="px-2.5 pb-2"
          onClick={() => {
            if (!window.getSelection()?.toString()) {
              onToggle();
            }
          }}
        >
          {action.detail ? (
            <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-[11px] leading-5 whitespace-pre-wrap break-words font-mono">
              <AnsiText text={action.detail} defaultTextClassName="text-white/45" />
            </pre>
          ) : null}
          {action.resultSummary ? (
            <div className="mt-1.5 text-[11px] break-words whitespace-pre-wrap font-mono">
              <AnsiText text={action.resultSummary} defaultTextClassName="text-white/35" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const ASSISTANT_MAX_WIDTH = "max-w-full md:max-w-[95%]";
const ASSISTANT_BUBBLE =
  "w-fit max-w-full rounded-2xl border border-white/8 bg-white/[0.03] px-2.5 py-2 md:px-4 md:py-3 text-[var(--text)] shadow-[0_2px_10px_rgba(0,0,0,0.22)]";
const ASSISTANT_LOADING_SHELL =
  "mt-[6px] inline-flex items-center overflow-hidden rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1";

function getActionSignature(action: Pick<MessageActionType, "kind" | "label" | "detail" | "toolName">) {
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

function MessageBubbleImpl({
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
  isForking = false,
  onRetryAssistantMessage,
  isRetrying = false,
  onRegenerateUserMessage,
  isRegenerating = false,
  onApproveMemoryProposal,
  onDismissMemoryProposal,
  onPreviewAttachment,
  readOnly = false
}: {
  message: MessageType;
  streamingTimeline?: MessageTimelineItem[];
  streamingThinking?: string;
  streamingAnswer?: string;
  awaitingFirstToken?: boolean;
  compactionInProgress?: boolean;
  thinkingInProgress?: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
  onUpdateUserMessage?: (messageId: string, content: string) => Promise<void>;
  onApproveMemoryProposal?: (
    actionId: string,
    overrides?: { content?: string; category?: MemoryCategory }
  ) => Promise<void>;
  onDismissMemoryProposal?: (actionId: string) => Promise<void>;
  isUpdating?: boolean;
  onForkAssistantMessage?: (messageId: string) => void;
  isForking?: boolean;
  onRetryAssistantMessage?: (messageId: string) => void;
  isRetrying?: boolean;
  onRegenerateUserMessage?: (messageId: string) => void;
  isRegenerating?: boolean;
  onPreviewAttachment?: (attachment: MessageAttachment) => void;
  readOnly?: boolean;
}) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [toolOpenItems, setToolOpenItems] = useState<Record<string, boolean>>({});
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const copyResetHandle = useRef<number | null>(null);
  const previewController = useAttachmentPreviewController();
  const userPlugins = useStreamdownPlugins(
    message.role === "user" ? streamingAnswer ?? message.content : ""
  );

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

  const derived = useMemo(() => {
    const rawContent = streamingAnswer ?? message.content;
    const rawThinking = streamingThinking ?? message.thinkingContent;
    const actions = message.actions ?? [];
    const liveTimeline = streamingTimeline ?? message.timeline;
    const contentForComparison = normalizeLineBreaks(rawContent);
    const timeline = liveTimeline ?? actions.map((action) => ({
      ...action,
      timelineKind: "action" as const
    }));
    const assistantBlocks: MessageTimelineItem[] = [];
    const deferredMemoryProposalBlocks: Extract<MessageTimelineItem, { timelineKind: "action" }>[] = [];
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
      return `${current}${next}`;
    }

    timeline.forEach((item) => {
      if (item.timelineKind === "action") {
        if (isMemoryProposalAction(item)) {
          deferredMemoryProposalBlocks.push(item);
          return;
        }

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
    const normalizedConsumedText = normalizeLineBreaks(consumedText);

    if (
      contentForComparison &&
      contentForComparison.length > normalizedConsumedText.length &&
      contentForComparison.startsWith(normalizedConsumedText)
    ) {
      assistantBlocks.push({
        id: `content_${message.id}_remaining`,
        timelineKind: "text",
        sortOrder: assistantBlocks.length,
        createdAt: message.createdAt,
        content: contentForComparison.slice(normalizedConsumedText.length)
      });
    }

    if (deferredMemoryProposalBlocks.length) {
      assistantBlocks.push(
        ...deferredMemoryProposalBlocks.map((item, index) => ({
          ...item,
          sortOrder: assistantBlocks.length + index
        }))
      );
    }

    const assistantText = assistantBlocks
      .filter(
        (item): item is Extract<MessageTimelineItem, { timelineKind: "text" }> =>
          item.timelineKind === "text"
      )
      .map((item) => item.content)
      .join("");
    const renderedAssistantText =
      message.role === "assistant"
        ? stripAttachmentStyleImageMarkdown(assistantText, message.attachments ?? [])
        : assistantText;
    const renderedAssistantBlockContentById = new Map<string, string>();
    let lastRenderableAssistantTextId: string | null = null;

    if (message.role === "assistant") {
      assistantBlocks.forEach((item) => {
        if (item.timelineKind !== "text") {
          return;
        }

        const renderedContent = stripAttachmentStyleImageMarkdown(item.content, message.attachments ?? []);

        renderedAssistantBlockContentById.set(item.id, renderedContent);

        if (renderedContent) {
          lastRenderableAssistantTextId = item.id;
        }
      });
    }

    return {
      content: rawContent,
      thinkingContent: rawThinking,
      assistantBlocks,
      renderedAssistantText,
      renderedAssistantBlockContentById,
      lastRenderableAssistantTextId
    };
  }, [message, streamingAnswer, streamingThinking, streamingTimeline]);

  const {
    content,
    thinkingContent,
    assistantBlocks,
    renderedAssistantText,
    renderedAssistantBlockContentById,
    lastRenderableAssistantTextId
  } = derived;

  function toggleToolItem(id: string) {
    setToolOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const assistantAttachments = message.role === "assistant" ? message.attachments ?? [] : [];
  const assistantImageAttachments = assistantAttachments.filter((attachment) => attachment.kind === "image");
  const assistantFileAttachments = assistantAttachments.filter((attachment) => attachment.kind === "text");
  const showStandaloneAssistantImageBubble =
    message.role === "assistant" &&
    assistantImageAttachments.length > 0 &&
    lastRenderableAssistantTextId === null;
  const showThinkingShell = !awaitingFirstToken && (thinkingInProgress || hasThinking || Boolean(thinkingContent));
  const showUserBubbleActions = Boolean(content) && !awaitingFirstToken;
  const isAssistantStreaming =
    message.role === "assistant" &&
    (
      message.status === "streaming" ||
      streamingTimeline !== undefined ||
      streamingThinking !== undefined ||
      streamingAnswer !== undefined
    );
  const showAssistantBubbleActions =
    Boolean(renderedAssistantText) &&
    !awaitingFirstToken &&
    !isAssistantStreaming;

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
          ? formatPlainTextHtml(renderedAssistantText)
          : formatPlainTextHtml(message.content);
      const text =
        message.role === "assistant"
          ? renderedAssistantText
          : message.content;

      await writeRichTextToClipboard({ html, text });
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

    try {
      await onUpdateUserMessage(message.id, nextContent);
      setIsEditing(false);
    } catch {}
  }

  function handleCancelEdit() {
    setDraft(message.content);
    setIsEditing(false);
  }

  const handleAttachmentPreview = onPreviewAttachment ?? previewController.openAttachmentPreview;

  if (message.role === "system") {
    return (
      <Message from="system" data-message-id={message.id}>
        <MessageContent className="mx-auto max-w-lg rounded-full border border-white/6 bg-white/[0.03] px-5 py-2 text-center text-[11px] tracking-[0.12em] text-white/40 uppercase">
          {message.content}
        </MessageContent>
      </Message>
    );
  }

  if (message.role === "user") {
    return (
      <>
        <Message from="user" data-message-id={message.id}>
          <div className="group flex w-full flex-col items-end md:max-w-[95%]">
            <MessageContent className={`${!readOnly && isEditing ? "w-full" : "w-fit max-w-full"} rounded-2xl border border-[var(--accent)]/10 bg-[var(--accent-soft)] px-4 py-3 text-[var(--text)]`}>
              {!readOnly && isEditing ? (
                <Textarea
                  ref={editRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-[88px] border-0 bg-transparent px-0 py-0 text-[14.5px] leading-7 text-[var(--text)] focus-visible:ring-0"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
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
                <div ref={contentRef} className="markdown-body">
                  <Streamdown mode="static" plugins={userPlugins}>{content.replace(/\n/g, "  \n")}</Streamdown>
                </div>
              ) : null}
              {message.attachments?.length ? (
                <div className={content || (!readOnly && isEditing) ? "mt-3" : ""}>
                  <MessageAttachments
                    attachments={message.attachments}
                    compact
                    onPreview={handleAttachmentPreview}
                  />
                </div>
              ) : null}
            </MessageContent>

            {showUserBubbleActions ? (
              <div className="mt-2 flex items-center gap-1 opacity-100 transition md:pointer-events-none md:translate-y-1 md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
                <MessageAction
                  label={copyState === "copied" ? "Copied" : "Copy message"}
                  tooltip={copyState === "copied" ? "Copied" : "Copy message"}
                  onClick={() => void handleCopy()}
                >
                  {copyState === "copied" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : copyState === "error" ? (
                    <X className="h-3.5 w-3.5 text-red-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </MessageAction>

                {!readOnly && onRegenerateUserMessage ? (
                  <MessageAction
                    label={isRegenerating ? "Regenerating..." : "Regenerate response"}
                    tooltip="Regenerate response"
                    onClick={() => onRegenerateUserMessage(message.id)}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </MessageAction>
                ) : null}

                {!readOnly && isEditing ? (
                  <>
                    <MessageAction
                      label="Save edit"
                      tooltip="Save edit"
                      onClick={() => void handleSaveEdit()}
                      disabled={isUpdating || !draft.trim()}
                    >
                      {isUpdating ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </MessageAction>
                    <MessageAction label="Cancel edit" tooltip="Cancel edit" onClick={handleCancelEdit} disabled={isUpdating}>
                      <X className="h-3.5 w-3.5" />
                    </MessageAction>
                  </>
                ) : !readOnly ? (
                  <MessageAction label="Edit message" tooltip="Edit message" onClick={() => setIsEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </MessageAction>
                ) : null}
              </div>
            ) : null}
          </div>
        </Message>
        {!onPreviewAttachment && previewController.previewAttachment ? (
          <AttachmentPreviewModal
            attachment={previewController.previewAttachment}
            state={previewController.previewState}
            onClose={previewController.closeAttachmentPreview}
            onRetry={() => void previewController.openAttachmentPreview(previewController.previewAttachment!)}
          />
        ) : null}
      </>
    );
  }

  return (
    <Message from="assistant" data-message-id={message.id}>
      <div className="flex flex-col gap-1 md:flex-row md:gap-3.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/6 text-[10px] font-bold text-white/60 overflow-hidden md:mt-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- Static assistant avatar is deliberately tiny and unoptimized. */}
          <img src="/agent-icon.png" alt="" width={28} height={28} className="h-full w-full object-cover" />
        </div>

        <div className="min-w-0 flex-1 text-[14.5px] text-[var(--text)] md:pt-0.5">
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
                  <div
                    className="markdown-body thinking-markdown-body mt-1.5"
                    onClick={() => {
                      if (!window.getSelection()?.toString()) {
                        setThinkingOpen(false);
                      }
                    }}
                  >
                    <Streamdown
                      caret={thinkingInProgress ? "block" : undefined}
                      isAnimating={thinkingInProgress}
                    >{thinkingContent}</Streamdown>
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
            ) : message.status === "error" ? (
              <div className="group flex w-full min-w-0 flex-col items-start">
                <MessageContent className={`w-full ${ASSISTANT_MAX_WIDTH} flex-col gap-3`}>
                  <div
                    className="w-fit max-w-full rounded-2xl border border-red-400/10 bg-red-500/5 px-2.5 py-2 text-red-300/85 shadow-[0_2px_10px_rgba(0,0,0,0.22)] md:px-4 md:py-3"
                    data-testid="assistant-error-bubble"
                  >
                    {content || "Something went wrong"}
                  </div>
                </MessageContent>
                {onRetryAssistantMessage ? (
                  <div className="mt-2 flex items-center gap-1">
                    <MessageAction
                      label="Retry message"
                      tooltip="Retry message"
                      onClick={() => onRetryAssistantMessage(message.id)}
                      disabled={isRetrying}
                    >
                      {isRetrying ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </MessageAction>
                  </div>
                ) : null}
              </div>
            ) : assistantBlocks.length || content || assistantImageAttachments.length || assistantFileAttachments.length ? (
              <div className="group flex w-full min-w-0 flex-col items-start">
                <MessageContent className={`w-full ${ASSISTANT_MAX_WIDTH}`}>
                  <div ref={contentRef} className="flex flex-col gap-3">
                    {assistantBlocks.map((item) => {
                      if (item.timelineKind === "action") {
                        return (
                          <div key={item.id} data-testid="assistant-actions-shell">
                            {isMemoryProposalAction(item) ? (
                              <MemoryProposalCard
                                action={item}
                                onApprove={onApproveMemoryProposal}
                                onDismiss={onDismissMemoryProposal}
                                readOnly={readOnly}
                              />
                            ) : (
                              <CollapsibleActionRow
                                action={item}
                                isOpen={toolOpenItems[item.id] ?? false}
                                onToggle={() => toggleToolItem(item.id)}
                              />
                            )}
                          </div>
                        );
                      }
                      const renderedContent =
                        renderedAssistantBlockContentById.get(item.id) ?? item.content;

                      if (!renderedContent) {
                        return null;
                      }
                      return (
                        <div
                          key={item.id}
                          className={ASSISTANT_BUBBLE}
                          data-testid="assistant-message-bubble"
                        >
                          <div className="markdown-body">
                            <AssistantMarkdown content={renderedContent} isStreaming={isAssistantStreaming} />
                          </div>
                          {item.id === lastRenderableAssistantTextId && assistantImageAttachments.length ? (
                            <div className="mt-3">
                              <AssistantInlineImageAttachments
                                attachments={assistantImageAttachments}
                                onPreview={handleAttachmentPreview}
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {showStandaloneAssistantImageBubble ? (
                      <div
                        className={ASSISTANT_BUBBLE}
                        data-testid="assistant-message-bubble"
                      >
                        <AssistantInlineImageAttachments
                          attachments={assistantImageAttachments}
                          onPreview={handleAttachmentPreview}
                        />
                      </div>
                    ) : null}
                    {message.status === "stopped" ? (
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-red-400/12 bg-red-400/8 px-2 py-1 text-[11px] text-red-200/85">
                        <Square className="h-2.5 w-2.5 fill-current" />
                        <span>Stopped</span>
                      </div>
                    ) : null}
                    {assistantFileAttachments.length ? (
                      <div>
                        <MessageAttachments
                          attachments={assistantFileAttachments}
                          onPreview={handleAttachmentPreview}
                        />
                      </div>
                    ) : null}
                  </div>
                </MessageContent>

                {showAssistantBubbleActions ? (
                  <div className="mt-2 flex items-center gap-1 opacity-100 transition md:pointer-events-none md:translate-y-1 md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
                    <MessageAction
                      label={copyState === "copied" ? "Copied" : "Copy message"}
                      tooltip={copyState === "copied" ? "Copied" : "Copy message"}
                      onClick={() => void handleCopy()}
                    >
                      {copyState === "copied" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : copyState === "error" ? (
                        <X className="h-3.5 w-3.5 text-red-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </MessageAction>
                    {onForkAssistantMessage && message.status === "completed" ? (
                      <MessageAction
                        label="Fork conversation from message"
                        tooltip="Fork conversation from message"
                        onClick={() => onForkAssistantMessage(message.id)}
                        disabled={isForking}
                      >
                        {isForking ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <GitFork className="h-3.5 w-3.5" />
                        )}
                      </MessageAction>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {!onPreviewAttachment && previewController.previewAttachment ? (
        <AttachmentPreviewModal
          attachment={previewController.previewAttachment}
          state={previewController.previewState}
          onClose={previewController.closeAttachmentPreview}
          onRetry={() => void previewController.openAttachmentPreview(previewController.previewAttachment!)}
        />
      ) : null}
    </Message>
  );
}

export const MessageBubble = React.memo(MessageBubbleImpl);

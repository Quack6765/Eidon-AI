"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot as BotIcon, Brain, Check, ChevronDown, ChevronRight, Copy, Forward, GitFork, LoaderCircle, PenLine, Pencil, RefreshCw, Square, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { math } from "@streamdown/math";
import { MarkdownErrorBoundary } from "@/components/markdown-error-boundary";
import {
  AttachmentPreviewModal,
  useAttachmentPreviewController
} from "@/components/attachment-preview-modal";
import { CompactionIndicator } from "@/components/compaction-indicator";
import { parseAnsiText } from "@/lib/ansi";
import { stripAttachmentStyleImageMarkdown } from "@/lib/assistant-image-markdown";
import { useStreamdownPlugins } from "@/lib/streamdown-plugins";
import { useLinkSafety } from "@/components/link-safety-modal";
import { writeRichTextToClipboard } from "@/lib/clipboard";
import {
  isMemoryProposalAction,
  getMemoryProposalHeading,
  MemoryProposalCard
} from "@/components/memory-proposal-card";
import {
  AutomationProposalCard,
  isAutomationProposalAction
} from "@/components/automation-proposal-card";
import {
  AttachmentTile,
  MessageAttachments,
  AssistantInlineImageAttachments
} from "@/components/message-attachments";
import { BotAvatar } from "@/components/agents/bot-avatar";
import { useBotAvatarSeed } from "@/hooks/use-bot-avatar-seeds";
import type {
  AutomationProposalOverrides
} from "@/lib/automation-proposals";
import type {
  MemoryCategory,
  MessageAction as MessageActionType,
  MessageTimelineItem,
  PublicMessage,
  PublicMessageAttachment,
  ToolCallDisplayMode
} from "@/lib/types";
import { normalizeRealLineBreaks } from "@/lib/text-utils";
import { Textarea } from "@/components/ui/textarea";
import {
  Message,
  MessageContent,
  MessageAction
} from "@/components/ai-elements/message";

const COPY_RESET_DELAY_MS = 1600;
const DELEGATION_WAKE_PATTERN = /^\[Message from (.+)\]$/;
const DELEGATE_LABEL_PATTERN = /^Messaged\s+(.+)$/;

function isMessageBotActionKind(kind: MessageActionType["kind"]) {
  return kind === "delegate_task" || kind === "message_bot";
}

export function parseDelegationWakeMessage(content: string): { botName: string; content: string } | null {
  if (!content.startsWith("[Message from ")) {
    return null;
  }

  const newlineIndex = content.indexOf("\n");
  const firstLine = (newlineIndex === -1 ? content : content.slice(0, newlineIndex)).trim();
  const match = DELEGATION_WAKE_PATTERN.exec(firstLine);

  if (!match || !match[1].trim()) {
    return null;
  }

  return {
    botName: match[1].trim(),
    content: newlineIndex === -1 ? "" : content.slice(newlineIndex + 1)
  };
}


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

const AssistantMarkdown = React.memo(
  function AssistantMarkdown({
    content,
    isAnimating = false,
    showCaret = false,
    isStatic = false,
    linkSafety
  }: {
    content: string;
    isAnimating?: boolean;
    showCaret?: boolean;
    isStatic?: boolean;
    linkSafety: ReturnType<typeof useLinkSafety>;
  }) {
    const sharedPlugins = useStreamdownPlugins(content);
    const plugins = useMemo(() => ({ math, ...sharedPlugins }), [sharedPlugins]);
    const fallback = (
      <pre className="whitespace-pre-wrap break-words text-sm">{content}</pre>
    );
    return (
      <MarkdownErrorBoundary fallback={fallback} resetKey={content}>
        <Streamdown
          plugins={plugins}
          mode={isStatic ? "static" : "streaming"}
          isAnimating={isAnimating}
          caret={showCaret ? "block" : undefined}
          linkSafety={linkSafety}
        >
          {content}
        </Streamdown>
      </MarkdownErrorBoundary>
    );
  },
  (previous, next) =>
    previous.content === next.content &&
    previous.isAnimating === next.isAnimating &&
    previous.showCaret === next.showCaret &&
    previous.isStatic === next.isStatic &&
    previous.linkSafety === next.linkSafety
);

export function InProgressIndicator() {
  return (
    <div
      className="w-fit rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 animate-fade-in"
      data-testid="assistant-in-progress"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5">
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <LoaderCircle className="h-3 w-3 animate-spin text-white/45" aria-hidden="true" />
        </span>
        <span className="flex items-center gap-1 text-[11px] leading-[16.5px] text-white/50">
          <span className="font-medium">Working</span>
          <span className="text-white/30" aria-hidden="true">...</span>
        </span>
      </span>
    </div>
  );
}

export function StatusLine({ label }: { label: string }) {
  return (
    <div
      className="status-line"
      data-testid="assistant-status-line"
      role="status"
      aria-live="polite"
    >
      <span className="status-line__label" data-testid="assistant-status-line-label">
        {label}
      </span>
    </div>
  );
}

function DelegateBotGlyph({ botName }: { botName: string }) {
  const seed = useBotAvatarSeed(botName);

  if (!seed) {
    return <BotIcon className="ml-2.5 mr-1.5 h-3 w-3 shrink-0 text-white/40" aria-hidden="true" />;
  }

  return <BotAvatar inline seed={seed} size={14} className="ml-2.5 mr-1.5" />;
}

function DelegateActionLine({
  action,
  isOpen,
  onToggle
}: {
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isFailed = action.status === "error" || action.status === "stopped";
  const canExpand = action.status === "completed" && Boolean(action.resultSummary);
  const botName =
    DELEGATE_LABEL_PATTERN.exec(action.label)?.[1] ??
    (typeof action.arguments?.bot === "string" ? action.arguments.bot.trim() : "");
  const line = (
    <span
      className={`flex min-w-0 max-w-full items-center gap-1.5 text-xs leading-4 ${
        isFailed ? "text-red-300/70" : "text-white/40"
      }`}
    >
      {action.status === "error" ? (
        <X className="h-3 w-3 shrink-0 text-red-400" aria-hidden="true" />
      ) : action.status === "stopped" ? (
        <Square className="h-3 w-3 shrink-0 fill-current text-red-400" aria-hidden="true" />
      ) : null}
      <span className="min-w-0 truncate">
        {botName ? (
          <>
            {"Messaged "}
            <DelegateBotGlyph botName={botName} />
            <span className={isFailed ? undefined : "text-white/60"}>{botName}</span>
          </>
        ) : (
          action.label
        )}
      </span>
      {canExpand ? (
        isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-white/30" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-white/30" aria-hidden="true" />
        )
      ) : null}
    </span>
  );

  return (
    <div
      className="flex w-full min-w-0 flex-col items-center gap-1"
      data-testid="delegate-action-line"
      data-action-status={action.status}
    >
      {canExpand ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex max-w-full min-w-0 items-center justify-center rounded transition hover:opacity-80"
        >
          {line}
        </button>
      ) : (
        line
      )}
      {canExpand && isOpen && action.resultSummary ? (
        <div className="max-w-full px-6 text-center text-[11px] break-words whitespace-pre-wrap font-mono">
          <AnsiText text={action.resultSummary} defaultTextClassName="text-white/35" />
        </div>
      ) : null}
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
  const kindIcon = isMessageBotActionKind(action.kind) ? (
    <Forward className="h-3 w-3 shrink-0 text-sky-300" aria-hidden="true" />
  ) : action.kind === "create_bot" ? (
    <BotIcon className="h-3 w-3 shrink-0 text-violet-400" aria-hidden="true" />
  ) : action.kind === "update_bot" ? (
    <PenLine className="h-3 w-3 shrink-0 text-amber-300" aria-hidden="true" />
  ) : null;
  const argumentQuery = typeof action.arguments?.query === "string"
    ? action.arguments.query.trim()
    : "";
  const webSearchQuery = action.toolName === "web_search"
    ? argumentQuery || action.detail.trim()
    : "";
  const expandedDetail = webSearchQuery ? "" : action.detail;
  const actionTitle = (
    <span
      className={`min-w-0 break-words text-xs font-medium leading-4 ${
        action.status === "running" ? "text-white/55" : "text-white/85"
      }`}
    >
      {kindIcon ? (
        <span className="mr-1 inline-flex translate-y-px align-middle">{kindIcon}</span>
      ) : null}
      {action.label}
      {webSearchQuery ? (
        <>
          {": "}
          <span className={action.status === "running" ? "font-normal text-white/45" : "font-normal text-white/55"}>
            {webSearchQuery}
          </span>
        </>
      ) : null}
    </span>
  );

  const statusIcon = action.status === "running"
    ? <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />
    : action.status === "completed"
      ? <Check className="h-2.5 w-2.5 text-emerald-400" />
      : action.status === "stopped"
        ? <Square className="h-2.5 w-2.5 text-red-400 fill-current" />
        : <X className="h-2.5 w-2.5 text-red-400" />;

  if (action.status === "running") {
    return (
      <div className="inline-flex w-fit max-w-full items-start gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-xs">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {isMemoryAction ? <Brain className="h-2.5 w-2.5 text-violet-400" /> : statusIcon}
        </span>
        {actionTitle}
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
        className={`flex max-w-full items-start gap-1.5 px-2.5 py-1.5 text-left transition hover:opacity-80 ${isOpen ? "w-full" : "w-fit min-w-0"}`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {isMemoryAction ? <Brain className="h-3 w-3 text-violet-400" /> : statusIcon}
        </span>
        {actionTitle}
        <span className="ml-auto flex items-center pt-px">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
        </span>
      </button>
      {isOpen && (expandedDetail || action.resultSummary) ? (
        <div
          className="px-2.5 pb-2"
          onClick={() => {
            if (!window.getSelection()?.toString()) {
              onToggle();
            }
          }}
        >
          {expandedDetail ? (
            <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-[11px] leading-5 whitespace-pre-wrap break-words font-mono">
              <AnsiText text={expandedDetail} defaultTextClassName="text-white/45" />
            </pre>
          ) : null}
          {action.resultSummary ? (
            <div className={`${expandedDetail ? "mt-1.5 " : ""}text-[11px] break-words whitespace-pre-wrap font-mono`}>
              <AnsiText text={action.resultSummary} defaultTextClassName="text-white/35" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const ASSISTANT_CONTENT =
  "w-full max-w-full text-[var(--text)]";
const ASSISTANT_ERROR_MAX_WIDTH = "max-w-full md:max-w-[95%]";
type ThinkingTimelineItem = Extract<MessageTimelineItem, { timelineKind: "thinking" }>;
type RenderedThinkingTimelineItem = ThinkingTimelineItem & { content: string };
type AssistantBlock =
  | Extract<MessageTimelineItem, { timelineKind: "text" }>
  | Extract<MessageTimelineItem, { timelineKind: "action" }>
  | RenderedThinkingTimelineItem;

function getActionSignature(action: Pick<MessageActionType, "kind" | "label" | "detail" | "toolName">) {
  return [action.kind, action.label, action.detail, action.toolName ?? ""].join("\u0000");
}

function isRunningActionBlock(
  item: AssistantBlock
): item is Extract<MessageTimelineItem, { timelineKind: "action" }> {
  return item.timelineKind === "action" && item.status === "running";
}

function clampStreamingTimeline(
  timeline: MessageTimelineItem[],
  display: string
): MessageTimelineItem[] {
  const clamped: MessageTimelineItem[] = [];
  let offset = 0;

  for (const item of timeline) {
    if (item.timelineKind !== "text") {
      clamped.push(item);
      continue;
    }

    const visibleLength = Math.min(
      Math.max(display.length - offset, 0),
      item.content.length
    );

    if (visibleLength > 0) {
      clamped.push(
        visibleLength === item.content.length
          ? item
          : { ...item, content: item.content.slice(0, visibleLength) }
      );
    }

    offset += item.content.length;
  }

  return clamped;
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
  confirmExternalLinks = true,
  toolCallDisplay = "pills",
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
  onApproveAutomationProposal,
  onDismissAutomationProposal,
  onPreviewAttachment,
  readOnly = false
}: {
  message: PublicMessage;
  streamingTimeline?: MessageTimelineItem[];
  streamingThinking?: string;
  streamingAnswer?: string;
  awaitingFirstToken?: boolean;
  compactionInProgress?: boolean;
  thinkingInProgress?: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
  confirmExternalLinks?: boolean;
  toolCallDisplay?: ToolCallDisplayMode;
  onUpdateUserMessage?: (messageId: string, content: string) => Promise<void>;
  onApproveMemoryProposal?: (
    actionId: string,
    overrides?: { content?: string; category?: MemoryCategory }
  ) => Promise<void>;
  onDismissMemoryProposal?: (actionId: string) => Promise<void>;
  onApproveAutomationProposal?: (actionId: string, overrides?: AutomationProposalOverrides) => Promise<void>;
  onDismissAutomationProposal?: (actionId: string) => Promise<void>;
  isUpdating?: boolean;
  onForkAssistantMessage?: (messageId: string) => void;
  isForking?: boolean;
  onRetryAssistantMessage?: (messageId: string) => void;
  isRetrying?: boolean;
  onRegenerateUserMessage?: (messageId: string) => void;
  isRegenerating?: boolean;
  onPreviewAttachment?: (attachment: PublicMessageAttachment) => void;
  readOnly?: boolean;
}) {
  const [thinkingOpenItems, setThinkingOpenItems] = useState<Record<string, boolean>>({});
  const [toolOpenItems, setToolOpenItems] = useState<Record<string, boolean>>({});
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const copyResetHandle = useRef<number | null>(null);
  const stripCacheRef = useRef<{
    key: string;
    byBlockId: Map<string, { source: string; rendered: string }>;
  } | null>(null);
  const previewController = useAttachmentPreviewController();
  const linkSafety = useLinkSafety(confirmExternalLinks);
  const useStatusLine = toolCallDisplay === "status_line";
  const sharedUserPlugins = useStreamdownPlugins(
    message.role === "user" ? streamingAnswer ?? message.content : ""
  );
  const userPlugins = useMemo(
    () => ({ math, ...sharedUserPlugins }),
    [sharedUserPlugins]
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
    const rawThinking = streamingThinking ?? message.thinkingContent ?? "";
    const actions = message.actions ?? [];
    const liveTimeline =
      streamingTimeline !== undefined && streamingAnswer !== undefined
        ? clampStreamingTimeline(streamingTimeline, streamingAnswer)
        : streamingTimeline ?? message.timeline;
    const contentForComparison = normalizeRealLineBreaks(rawContent);
    const timeline = liveTimeline ?? actions.map((action) => ({
      ...action,
      timelineKind: "action" as const
    }));
    const assistantBlocks: AssistantBlock[] = [];
    const deferredProposalBlocks: Extract<MessageTimelineItem, { timelineKind: "action" }>[] = [];
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
      if (item.timelineKind === "thinking") {
        appendBufferedText();
        const visibleEnd = Math.min(
          item.endOffset ?? rawThinking.length,
          rawThinking.length
        );
        assistantBlocks.push({
          ...item,
          content: rawThinking.slice(item.startOffset, visibleEnd)
        });
        return;
      }

      if (item.timelineKind === "action") {
        if (isMemoryProposalAction(item) || isAutomationProposalAction(item)) {
          deferredProposalBlocks.push(item);
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
    const normalizedConsumedText = normalizeRealLineBreaks(consumedText);

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

    if (deferredProposalBlocks.length) {
      assistantBlocks.push(
        ...deferredProposalBlocks.map((item, index) => ({
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
    const renderedAssistantBlockContentById = new Map<string, string>();
    let lastRenderableAssistantTextId: string | null = null;
    let renderedAssistantText = assistantText;

    if (message.role === "assistant") {
      const attachments = message.attachments ?? [];
      const cacheKey = `${message.id} ${attachments.map((attachment) => attachment.id).join(",")}`;

      if (stripCacheRef.current?.key !== cacheKey) {
        stripCacheRef.current = { key: cacheKey, byBlockId: new Map() };
      }

      const stripCache = stripCacheRef.current.byBlockId;
      const renderedParts: string[] = [];

      assistantBlocks.forEach((item) => {
        if (item.timelineKind !== "text") {
          return;
        }

        const cached = stripCache.get(item.id);
        const renderedContent =
          cached && cached.source === item.content
            ? cached.rendered
            : stripAttachmentStyleImageMarkdown(item.content, attachments);

        if (cached?.source !== item.content) {
          stripCache.set(item.id, { source: item.content, rendered: renderedContent });
        }

        renderedAssistantBlockContentById.set(item.id, renderedContent);
        renderedParts.push(renderedContent);

        if (renderedContent) {
          lastRenderableAssistantTextId = item.id;
        }
      });

      renderedAssistantText = renderedParts.join("");
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
  const delegationWake = message.role === "user" ? parseDelegationWakeMessage(content) : null;

  function toggleToolItem(id: string) {
    setToolOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleThinkingItem(id: string) {
    setThinkingOpenItems((previous) => ({
      ...previous,
      [id]: !previous[id]
    }));
  }

  function renderThinkingShell({
    id,
    content: thinkingShellContent,
    status,
    duration
  }: {
    id: string;
    content: string;
    status: "running" | "completed" | "error" | "stopped";
    duration?: number;
  }) {
    if (useStatusLine) {
      return null;
    }

    const isOpen = thinkingOpenItems[id] ?? false;
    const isRunning = status === "running";
    const statusIcon = isRunning
      ? <LoaderCircle className="h-3 w-3 animate-spin text-white/45" />
      : status === "completed"
        ? <Check className="h-3 w-3 text-emerald-400/80" />
        : status === "stopped"
          ? <Square className="h-3 w-3 fill-current text-red-400" />
          : <X className="h-3 w-3 text-red-400" />;

    return (
      <div
        key={id}
        data-testid="assistant-thinking-shell"
        data-thinking-status={status}
        className="w-fit rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 transition-all duration-300"
      >
        <button
          type="button"
          onClick={() => toggleThinkingItem(id)}
          className="flex w-full items-center gap-1.5 text-left transition hover:opacity-80"
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {statusIcon}
          </span>
          <span className="flex items-center gap-1 text-[11px] leading-[16.5px] text-white/50">
            <span className="font-medium">{isRunning ? "Thinking" : "Thought"}</span>
            {isRunning ? (
              <span className="text-white/30">...</span>
            ) : duration ? (
              <span className="text-white/30">({duration.toFixed(1)}s)</span>
            ) : null}
          </span>
          <span className="ml-auto flex items-center">
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-white/30" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-white/30" />
            )}
          </span>
        </button>

        {isOpen && thinkingShellContent ? (
          <div
            className="markdown-body thinking-markdown-body mt-1.5"
            onClick={() => {
              if (!window.getSelection()?.toString()) {
                toggleThinkingItem(id);
              }
            }}
          >
            <Streamdown linkSafety={linkSafety}>{thinkingShellContent}</Streamdown>
          </div>
        ) : null}
      </div>
    );
  }

  function renderAssistantActionItem(item: Extract<MessageTimelineItem, { timelineKind: "action" }>) {
    if (isAutomationProposalAction(item)) {
      if (isAssistantStreaming) {
        return null;
      }

      return (
        <div key={item.id} data-testid="assistant-actions-shell">
          <AutomationProposalCard
            action={item}
            onApprove={onApproveAutomationProposal}
            onDismiss={onDismissAutomationProposal}
            readOnly={readOnly}
          />
        </div>
      );
    }

    if (isMemoryProposalAction(item)) {
      if (isAssistantStreaming) {
        return null;
      }

      return (
        <div key={item.id} data-testid="assistant-actions-shell">
          <MemoryProposalCard
            action={item}
            onApprove={onApproveMemoryProposal}
            onDismiss={onDismissMemoryProposal}
            readOnly={readOnly}
          />
        </div>
      );
    }

    if (isMessageBotActionKind(item.kind)) {
      return (
        <DelegateActionLine
          key={item.id}
          action={item}
          isOpen={toolOpenItems[item.id] ?? false}
          onToggle={() => toggleToolItem(item.id)}
        />
      );
    }

    if (useStatusLine) {
      return null;
    }

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

  const assistantAttachments = message.role === "assistant" ? message.attachments ?? [] : [];
  const assistantImageAttachments = assistantAttachments.filter((attachment) => attachment.kind === "image");
  const assistantFileAttachments = assistantAttachments.filter((attachment) => attachment.kind !== "image");
  const showStandaloneAssistantImageBubble =
    message.role === "assistant" &&
    assistantImageAttachments.length > 0 &&
    lastRenderableAssistantTextId === null;
  const hasTimelineThinking = assistantBlocks.some((item) => item.timelineKind === "thinking");
  const showThinkingShell =
    !useStatusLine &&
    !hasTimelineThinking &&
    !awaitingFirstToken &&
    (thinkingInProgress || hasThinking || Boolean(thinkingContent));
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
  const thinkingShell = showThinkingShell
    ? renderThinkingShell({
        id: `thinking_${message.id}`,
        content: thinkingContent,
        status: thinkingInProgress ? "running" : "completed",
        duration: thinkingDuration
      })
    : null;

  const lastAssistantBlock = assistantBlocks[assistantBlocks.length - 1];
  const lastBlockIsRunningAction =
    lastAssistantBlock?.timelineKind === "action" && lastAssistantBlock.status === "running";
  const lastBlockIsRunningDelegate =
    lastBlockIsRunningAction && isMessageBotActionKind(lastAssistantBlock.kind);
  const lastBlockIsRunningThinking =
    lastAssistantBlock?.timelineKind === "thinking" && lastAssistantBlock.status === "running";
  const lastBlockIsStreamingText =
    isAssistantStreaming &&
    lastAssistantBlock?.timelineKind === "text" &&
    lastAssistantBlock.id === lastRenderableAssistantTextId;
  const showInProgressTail =
    isAssistantStreaming &&
    !awaitingFirstToken &&
    message.status !== "error" &&
    message.status !== "stopped" &&
    !lastBlockIsRunningAction &&
    !lastBlockIsRunningThinking &&
    !lastBlockIsStreamingText &&
    !(showThinkingShell && thinkingInProgress);
  const betweenSteps =
    isAssistantStreaming &&
    !awaitingFirstToken &&
    message.status !== "error" &&
    message.status !== "stopped" &&
    !lastBlockIsStreamingText &&
    !lastBlockIsRunningDelegate &&
    !(showThinkingShell && thinkingInProgress);
  const showStatusLine =
    useStatusLine &&
    isAssistantStreaming &&
    message.status !== "error" &&
    message.status !== "stopped" &&
    !compactionInProgress &&
    !lastBlockIsStreamingText &&
    !lastBlockIsRunningDelegate &&
    (lastBlockIsRunningAction || lastBlockIsRunningThinking || thinkingInProgress || betweenSteps);
  const statusLineRunningAction = useStatusLine
    ? assistantBlocks
        .slice()
        .reverse()
        .find(
          (item): item is Extract<MessageTimelineItem, { timelineKind: "action" }> =>
            isRunningActionBlock(item) && !isMessageBotActionKind(item.kind)
        )
    : undefined;
  const statusLineWebSearchQuery = statusLineRunningAction?.toolName === "web_search"
    ? (typeof statusLineRunningAction.arguments?.query === "string"
        ? statusLineRunningAction.arguments.query.trim()
        : "") || statusLineRunningAction.detail.trim()
    : "";
  const statusLineLabel = statusLineRunningAction
    ? statusLineWebSearchQuery
      ? `${statusLineRunningAction.label}: ${statusLineWebSearchQuery}`
      : statusLineRunningAction.label
    : lastBlockIsRunningThinking || thinkingInProgress
      ? "Thinking…"
      : "Working…";

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
    if (delegationWake && !isEditing) {
      return (
        <Message from="user" data-message-id={message.id}>
          <div
            className="flex w-full min-w-0 flex-col items-stretch gap-2"
            data-testid="delegation-wake-message"
          >
            <div className="flex w-full min-w-0 justify-center">
              <span className="flex min-w-0 max-w-full items-center gap-1.5 text-xs leading-4 text-white/40">
                <span className="min-w-0 truncate">
                  {"Message from "}
                  <DelegateBotGlyph botName={delegationWake.botName} />
                  <span className="text-white/60">{delegationWake.botName}</span>
                </span>
              </span>
            </div>
          </div>
        </Message>
      );
    }

    return (
      <>
        <Message from="user" data-message-id={message.id}>
          <div className="group flex w-full flex-col items-end md:max-w-[95%]">
            <MessageContent className={`${!readOnly && isEditing ? "w-full" : "w-fit max-w-full"} gap-1 rounded-2xl border border-[var(--accent)]/10 bg-[var(--accent-soft)] px-4 py-3 text-[var(--text)]`}>
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
                  <Streamdown mode="static" plugins={userPlugins} linkSafety={linkSafety}>{content.replace(/\n/g, "  \n")}</Streamdown>
                </div>
              ) : null}
              {message.attachments?.length ? (
                <div>
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
      <div className="flex w-full flex-col gap-1">
        <div className="min-w-0 w-full text-[14.5px] text-[var(--text)]">
          <div className="flex flex-col items-start gap-3">
            {thinkingShell}

            {awaitingFirstToken ? (
              compactionInProgress ? (
                <CompactionIndicator />
              ) : useStatusLine ? (
                <StatusLine label="Working…" />
              ) : (
                <InProgressIndicator />
              )
            ) : message.status === "error" ? (
              <div className="group flex w-full min-w-0 flex-col items-start">
                <MessageContent className={`w-full ${ASSISTANT_ERROR_MAX_WIDTH} flex-col gap-3`}>
                  {assistantBlocks
                    .filter((item) => item.timelineKind !== "text")
                    .map((item) =>
                      item.timelineKind === "thinking"
                        ? renderThinkingShell({
                            id: item.id,
                            content: item.content,
                            status: item.status,
                            duration: item.completedAt
                              ? (Date.parse(item.completedAt) - Date.parse(item.startedAt)) / 1000
                              : undefined
                          })
                        : renderAssistantActionItem(item)
                    )}
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
                <MessageContent className="w-full">
                  <div ref={contentRef} className="flex flex-col gap-3">
                    {showStatusLine ? (
                      <StatusLine label={statusLineLabel} />
                    ) : null}
                    {assistantBlocks.map((item) => {
                      if (item.timelineKind === "thinking") {
                        return renderThinkingShell({
                          id: item.id,
                          content: item.content,
                          status: item.status,
                          duration: item.completedAt
                            ? (Date.parse(item.completedAt) - Date.parse(item.startedAt)) / 1000
                            : undefined
                        });
                      }

                      if (item.timelineKind === "action") {
                        return renderAssistantActionItem(item);
                      }
                      const renderedContent =
                        renderedAssistantBlockContentById.get(item.id) ?? item.content;

                      if (!renderedContent) {
                        return null;
                      }
                      const isStreamingTailBlock =
                        isAssistantStreaming && item.id === lastRenderableAssistantTextId;
                      return (
                        <div
                          key={item.id}
                          className={ASSISTANT_CONTENT}
                          data-testid="assistant-message-content"
                        >
                          <div className="markdown-body">
                            <AssistantMarkdown
                              content={renderedContent}
                              isAnimating={isStreamingTailBlock}
                              showCaret={isStreamingTailBlock}
                              isStatic={!isStreamingTailBlock && message.status === "completed"}
                              linkSafety={linkSafety}
                            />
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
                        className={ASSISTANT_CONTENT}
                        data-testid="assistant-message-content"
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
                    {!useStatusLine && showInProgressTail ? (
                      <InProgressIndicator />
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
            ) : showStatusLine ? (
              <StatusLine label={statusLineLabel} />
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

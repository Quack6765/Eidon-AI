"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="instant"
    resize="instant"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
> & {
  scrollerRef?: React.RefCallback<HTMLElement>;
};

export const ConversationContent = ({
  className,
  scrollClassName,
  scrollerRef,
  ...props
}: ConversationContentProps) => (
  <div ref={scrollerRef as React.RefCallback<HTMLDivElement>} className="h-full overflow-hidden">
    <StickToBottom.Content
      scrollClassName={cn(
        "conversation-scroller overscroll-y-contain no-scrollbar",
        scrollClassName
      )}
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  </div>
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-white/45">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-white/45 text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

const SCROLL_TO_LATEST_OPTIONS = {
  animation: { damping: 0.75, stiffness: 0.1, mass: 1 },
  ignoreEscapes: true
} as const;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom(SCROLL_TO_LATEST_OPTIONS);
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        aria-label="Scroll to latest messages"
        className={cn(
          "absolute bottom-[calc(var(--composer-height,160px)_+_6px)] left-[50%] z-10 translate-x-[-50%] flex h-8 items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_0_16px_var(--accent-glow)] transition-all duration-200 animate-fade-in hover:bg-[var(--accent)] hover:text-white hover:opacity-90 active:scale-[0.96]",
          className
        )}
        onClick={handleScrollToBottom}
        size="sm"
        type="button"
        variant="ghost"
        {...props}
      >
        <ArrowDownIcon className="size-3.5" />
        Latest
      </Button>
    )
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full border border-white/10 bg-white/[0.06] text-white/60 hover:bg-white/[0.1]",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};

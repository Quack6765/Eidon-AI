"use client";

import React, { useCallback } from "react";

import {
  AttachmentPreviewModal,
  AttachmentUrlProvider,
  type AttachmentUrlOptions,
  useAttachmentPreviewController
} from "@/components/attachment-preview-modal";
import { MessageBubble } from "@/components/message-bubble";
import type { Conversation, Message, MessageAttachment } from "@/lib/types";

function buildSharedAttachmentUrl(
  shareToken: string,
  attachment: Pick<MessageAttachment, "id">,
  options?: AttachmentUrlOptions
) {
  const params = new URLSearchParams();

  if (options?.format) {
    params.set("format", options.format);
  }

  if (options?.download) {
    params.set("download", "1");
  }

  const query = params.toString();
  const path = `/api/share/${shareToken}/attachments/${attachment.id}`;
  return query ? `${path}?${query}` : path;
}

export function SharedConversationView({
  conversation,
  messages,
  shareToken
}: {
  conversation: Conversation;
  messages: Message[];
  shareToken: string;
}) {
  const buildAttachmentUrl = useCallback(
    (attachment: Pick<MessageAttachment, "id">, options?: AttachmentUrlOptions) =>
      buildSharedAttachmentUrl(shareToken, attachment, options),
    [shareToken]
  );

  return (
    <AttachmentUrlProvider value={buildAttachmentUrl}>
      <SharedConversationTranscript conversation={conversation} messages={messages} />
    </AttachmentUrlProvider>
  );
}

function SharedConversationTranscript({
  conversation,
  messages
}: {
  conversation: Conversation;
  messages: Message[];
}) {
  const previewController = useAttachmentPreviewController();

  return (
    <main className="relative flex min-h-[100dvh] w-full flex-col bg-[var(--background)] text-[var(--text)]">
      <header className="border-b border-white/4 px-4 py-3.5 md:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <a
              href="https://github.com/Quack6765/Eidon-AI"
              aria-label="Eidon"
              className="flex shrink-0 items-center transition-opacity hover:opacity-80"
            >
              <span
                style={{
                  filter: "drop-shadow(0 0 8px rgba(139,92,246,0.5)) drop-shadow(0 0 20px rgba(139,92,246,0.25)) drop-shadow(0 0 36px rgba(139,92,246,0.12))"
                }}
              >
                <span
                  className="inline-block text-[24px] font-bold leading-none tracking-[0.12em]"
                  style={{
                    fontFamily: "var(--font-wordmark), 'Eurostile', 'Space Grotesk', sans-serif",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundImage: "linear-gradient(to bottom, #FFFFFF 0%, #D4C8FF 40%, #8b5cf6 100%)"
                  }}
                >
                  Eidon
                </span>
              </span>
            </a>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--text)]">
                {conversation.title}
              </div>
            </div>
          </div>
          <span className="w-fit rounded-full border border-white/8 px-2.5 py-1 text-[11px] font-medium text-white/45">
            Read only
          </span>
        </div>
      </header>

      <section
        className="no-scrollbar relative z-0 isolate min-h-0 flex-1 overflow-y-auto px-2 md:px-8"
        aria-label="Shared transcript"
      >
        <div className="flex w-full flex-col gap-2.5 px-2 pt-4 pb-10 md:gap-4 md:px-0">
          {messages.length > 0 ? (
            messages.map((message) => (
              <div
                key={message.id}
                className="animate-slide-up"
                style={{ animationFillMode: "forwards" }}
              >
                <MessageBubble
                  message={message}
                  onPreviewAttachment={previewController.openAttachmentPreview}
                  readOnly
                />
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-5 text-sm text-[var(--muted)]">
              This shared conversation has no visible messages.
            </div>
          )}
        </div>
      </section>

      {previewController.previewAttachment ? (
        <AttachmentPreviewModal
          attachment={previewController.previewAttachment}
          state={previewController.previewState}
          onClose={previewController.closeAttachmentPreview}
          onRetry={() => void previewController.openAttachmentPreview(previewController.previewAttachment!)}
        />
      ) : null}
    </main>
  );
}

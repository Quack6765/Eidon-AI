"use client";

import React from "react";
import { FileText } from "lucide-react";
import type { MessageAttachment } from "@/lib/types";
import { useAttachmentUrlBuilder } from "@/components/attachment-preview-modal";

export function AttachmentTile({
  attachment,
  compact = false,
  onPreview
}: {
  attachment: MessageAttachment;
  compact?: boolean;
  onPreview: (attachment: MessageAttachment) => void;
}) {
  const buildAttachmentUrl = useAttachmentUrlBuilder();

  if (attachment.kind === "image") {
    return (
      <button
        type="button"
        aria-label={`Preview ${attachment.filename}`}
        onClick={() => onPreview(attachment)}
        className={`overflow-hidden rounded-xl border border-white/10 bg-black/20 ${compact ? "w-16" : "w-28"}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Attachment thumbnails are API-served user files that next/image cannot safely optimize. */}
        <img
          src={buildAttachmentUrl(attachment)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className={`w-full object-cover ${compact ? "h-16" : "h-28"}`}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Preview ${attachment.filename}`}
      onClick={() => onPreview(attachment)}
      className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-left"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/75">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-white">{attachment.filename}</span>
        <span className="block truncate text-xs text-white/60">{attachment.mimeType}</span>
      </span>
    </button>
  );
}

export function MessageAttachments({
  attachments,
  compact = false,
  onPreview
}: {
  attachments: MessageAttachment[];
  compact?: boolean;
  onPreview: (attachment: MessageAttachment) => void;
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
            <AttachmentTile
              key={attachment.id}
              attachment={attachment}
              compact={compact}
              onPreview={onPreview}
            />
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="space-y-2">
          {files.map((attachment) => (
            <AttachmentTile
              key={attachment.id}
              attachment={attachment}
              compact={compact}
              onPreview={onPreview}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AssistantInlineImageAttachments({
  attachments,
  onPreview
}: {
  attachments: MessageAttachment[];
  onPreview: (attachment: MessageAttachment) => void;
}) {
  const buildAttachmentUrl = useAttachmentUrlBuilder();

  if (!attachments.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2.5">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          aria-label={`Preview ${attachment.filename}`}
          onClick={() => onPreview(attachment)}
          className="max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/20"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Attachment previews are API-served user files that next/image cannot safely optimize. */}
          <img
            src={buildAttachmentUrl(attachment)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="block max-h-[28rem] w-auto max-w-full object-contain"
          />
        </button>
      ))}
    </div>
  );
}

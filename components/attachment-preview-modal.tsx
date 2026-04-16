"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";

import type { MessageAttachment } from "@/lib/types";

export type AttachmentPreviewState =
  | { kind: "loading" }
  | { kind: "image" }
  | { kind: "text"; content: string }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

type AttachmentPreviewModalProps = {
  attachment: MessageAttachment;
  state: AttachmentPreviewState;
  onClose: () => void;
  onRetry?: () => void;
};

export function useAttachmentPreviewController() {
  const [previewAttachment, setPreviewAttachment] = useState<MessageAttachment | null>(null);
  const [previewState, setPreviewState] = useState<AttachmentPreviewState>({
    kind: "unsupported"
  });
  const [textPreviewCache, setTextPreviewCache] = useState<Record<string, string>>({});
  const previewRequestTokenRef = useRef(0);
  const previewAttachmentIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      previewRequestTokenRef.current += 1;
      previewAttachmentIdRef.current = null;
    };
  }, []);

  function isCurrentPreviewRequest(requestToken: number, attachmentId: string) {
    return (
      previewRequestTokenRef.current === requestToken &&
      previewAttachmentIdRef.current === attachmentId
    );
  }

  const closeAttachmentPreview = useCallback(() => {
    previewRequestTokenRef.current += 1;
    previewAttachmentIdRef.current = null;
    setPreviewAttachment(null);
    setPreviewState({ kind: "unsupported" });
  }, []);

  const openAttachmentPreview = useCallback(
    async (attachment: MessageAttachment) => {
      const requestToken = previewRequestTokenRef.current + 1;
      const seededText =
        attachment.kind === "text" && attachment.extractedText.length > 0
          ? attachment.extractedText
          : null;

      previewRequestTokenRef.current = requestToken;
      previewAttachmentIdRef.current = attachment.id;
      setPreviewAttachment(attachment);
      setPreviewState(
        seededText !== null
          ? { kind: "text", content: seededText }
          : { kind: "loading" }
      );

      if (attachment.kind === "image") {
        const image = new Image();
        image.onload = () => {
          if (!isCurrentPreviewRequest(requestToken, attachment.id)) {
            return;
          }

          setPreviewState({ kind: "image" });
        };
        image.onerror = () => {
          if (!isCurrentPreviewRequest(requestToken, attachment.id)) {
            return;
          }

          setPreviewState({
            kind: "error",
            message: "Unable to load attachment preview."
          });
        };
        image.src = `/api/attachments/${attachment.id}`;
        return;
      }

      if (Object.hasOwn(textPreviewCache, attachment.id)) {
        const cached = textPreviewCache[attachment.id];
        if (!isCurrentPreviewRequest(requestToken, attachment.id)) {
          return;
        }

        setPreviewState({ kind: "text", content: cached });
        return;
      }

      try {
        const response = await fetch(`/api/attachments/${attachment.id}?format=text`);
        if (!isCurrentPreviewRequest(requestToken, attachment.id)) {
          return;
        }

        if (!response.ok) {
          if (response.status === 415) {
            if (seededText !== null) {
              return;
            }

            setPreviewState({ kind: "unsupported" });
            return;
          }

          if (seededText !== null) {
            return;
          }

          throw new Error("Unable to load attachment preview.");
        }

        const payload = await response.json();
        if (!isCurrentPreviewRequest(requestToken, attachment.id)) {
          return;
        }

        setTextPreviewCache((current) => ({ ...current, [attachment.id]: payload.content }));
        setPreviewState({ kind: "text", content: payload.content });
      } catch (error) {
        if (!isCurrentPreviewRequest(requestToken, attachment.id)) {
          return;
        }

        if (seededText !== null) {
          return;
        }

        setPreviewState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to load attachment preview."
        });
      }
    },
    [textPreviewCache]
  );

  return {
    previewAttachment,
    previewState,
    openAttachmentPreview,
    closeAttachmentPreview
  };
}

export function AttachmentPreviewModal({
  attachment,
  state,
  onClose,
  onRetry
}: AttachmentPreviewModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Attachment preview"
        className="flex max-h-[min(80vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121317] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/8 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Close attachment preview"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/75"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{attachment.filename}</div>
              <div className="truncate text-xs text-white/50">{attachment.mimeType}</div>
            </div>
          </div>

          <a
            href={`/api/attachments/${attachment.id}?download=1`}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70"
            aria-label="Download attachment"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download</span>
          </a>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {state.kind === "image" ? (
            <img
              src={`/api/attachments/${attachment.id}`}
              alt={attachment.filename}
              className="mx-auto max-h-[60vh] w-auto max-w-full rounded-xl"
            />
          ) : null}

          {state.kind === "loading" ? (
            <div className="flex h-full min-h-64 items-center justify-center text-sm text-white/55">
              Loading preview…
            </div>
          ) : null}

          {state.kind === "text" ? (
            <pre className="min-h-64 overflow-auto rounded-xl border border-white/8 bg-black/25 p-4 font-mono text-[13px] leading-6 text-white/85 whitespace-pre-wrap break-words">
              {state.content}
            </pre>
          ) : null}

          {state.kind === "unsupported" ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/12 bg-black/20 px-6 text-center">
              <FileText className="h-5 w-5 text-white/50" />
              <p className="text-sm text-white/70">Preview unavailable for this attachment type.</p>
            </div>
          ) : null}

          {state.kind === "error" ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-white/8 bg-black/20 px-6 text-center">
              <p className="text-sm text-white/70">{state.message}</p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/80"
              >
                Retry preview
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown";

function LinkSafetyModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; ignore silently.
    }
  }, [url]);

  const handleConfirm = useCallback(() => {
    onConfirm();
    onClose();
  }, [onConfirm, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-streamdown="link-safety-modal"
      onClick={onClose}
      role="button"
      tabIndex={0}
    >
      <div
        className="relative mx-4 flex w-full max-w-md flex-col gap-4 rounded-2xl border border-white/10 bg-[var(--background)] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="presentation"
      >
        <button
          className="absolute top-4 right-4 rounded-md p-1 text-[var(--muted)] transition-all hover:bg-white/10 hover:text-[var(--text)]"
          onClick={onClose}
          title="Close"
          type="button"
        >
          <X size={16} />
        </button>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-semibold text-lg text-[var(--text)]">
            <ExternalLink size={20} />
            <span>Open external link?</span>
          </div>
          <p className="text-sm text-[var(--muted)]">You are about to visit an external website.</p>
        </div>
        <div className="break-all rounded-lg bg-white/5 p-3 font-mono text-sm text-[var(--text)] max-h-32 overflow-y-auto">
          {url}
        </div>
        <div className="flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-[var(--text)] transition-all hover:bg-white/10"
            onClick={handleCopy}
            type="button"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? "Copied" : "Copy link"}</span>
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90"
            onClick={handleConfirm}
            type="button"
          >
            <ExternalLink size={14} />
            <span>Open link</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function buildLinkSafetyConfig(confirmExternalLinks: boolean): LinkSafetyConfig {
  if (confirmExternalLinks) {
    return {
      enabled: true,
      renderModal: (props) => <LinkSafetyModal {...props} />
    };
  }
  return {
    enabled: true,
    onLinkCheck: () => true,
    renderModal: (props) => <LinkSafetyModal {...props} />
  };
}

export function useLinkSafety(confirmExternalLinks: boolean): LinkSafetyConfig {
  return useMemo(
    () => buildLinkSafetyConfig(confirmExternalLinks),
    [confirmExternalLinks]
  );
}

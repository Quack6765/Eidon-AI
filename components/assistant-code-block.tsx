"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";

import { renderHighlightedCode } from "@/lib/code-highlighting";

const COPY_RESET_DELAY_MS = 1600;

export function AssistantCodeBlock({
  code,
  language
}: {
  code: string;
  language?: string | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetHandle = useRef<number | null>(null);
  const highlighted = renderHighlightedCode(language, code);

  useEffect(() => {
    return () => {
      if (resetHandle.current) {
        window.clearTimeout(resetHandle.current);
      }
    };
  }, []);

  function setCopyFeedback(nextState: "copied" | "error") {
    setCopyState(nextState);

    if (resetHandle.current) {
      window.clearTimeout(resetHandle.current);
    }

    resetHandle.current = window.setTimeout(() => {
      setCopyState("idle");
      resetHandle.current = null;
    }, COPY_RESET_DELAY_MS);
  }

  async function handleCopy() {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(code);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("error");
    }
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/8 bg-black/35"
      data-testid="assistant-code-block"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-3 py-2 text-[11px]">
        <span className="font-mono text-white/45">
          {highlighted.displayLanguage ?? "text"}
        </span>
        <button
          type="button"
          aria-label={copyState === "copied" ? "Copied code block" : "Copy code block"}
          onClick={() => void handleCopy()}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/8 bg-white/[0.03] text-white/45 transition hover:border-white/14 hover:text-white/70"
        >
          {copyState === "copied" ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : copyState === "error" ? (
            <X className="h-3.5 w-3.5 text-red-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-[13px] leading-6 text-white/88">
        <code
          className={`hljs${highlighted.language ? ` language-${highlighted.language}` : ""}`}
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      </pre>
    </div>
  );
}

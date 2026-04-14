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
  const displayLanguage = highlighted.displayLanguage ?? "text";

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
      className="assistant-code-block"
      data-testid="assistant-code-block"
    >
      <div className="assistant-code-block__header">
        <span className="assistant-code-block__language" title={displayLanguage}>
          {displayLanguage}
        </span>
        <button
          type="button"
          aria-label={copyState === "copied" ? "Copied code block" : "Copy code block"}
          onClick={() => void handleCopy()}
          className="assistant-code-block__copy"
          data-copy-state={copyState}
        >
          {copyState === "copied" ? (
            <Check className="h-3.5 w-3.5" />
          ) : copyState === "error" ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre className="assistant-code-block__body">
        <code
          className={`assistant-code-block__code hljs${highlighted.language ? ` language-${highlighted.language}` : ""}`}
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      </pre>
    </div>
  );
}

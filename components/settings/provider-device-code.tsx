"use client";

import { Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { writeTextToClipboard } from "@/lib/clipboard";

export type DeviceCodeFlow = {
  flowId: string;
  userCode: string;
  authorizationUrl: string;
  expiresAt: string;
};

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ProviderDeviceCode({
  flow,
  providerLabel,
  onCancel
}: {
  flow: DeviceCodeFlow;
  providerLabel: string;
  onCancel(): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const remaining = Date.parse(flow.expiresAt) - now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="@container space-y-4 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-4">
      <div>
        <p className="text-sm text-[var(--text)]">Finish connecting {providerLabel}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Open the sign-in page, enter this code, and approve the connection.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={`Sign-in code ${flow.userCode}`}
          className="flex flex-wrap items-center gap-1"
        >
          {Array.from(flow.userCode).map((character, index) =>
            character === "-" ? (
              <span key={index} aria-hidden="true" className="px-0.5 text-[var(--muted)]">–</span>
            ) : (
              <span
                key={index}
                aria-hidden="true"
                className="flex h-10 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] font-mono text-base font-semibold text-[var(--text)] @xs:w-7 @sm:w-8"
              >
                {character}
              </span>
            )
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={copied ? "Code copied" : "Copy code"}
          className="min-h-11 min-w-11 text-[var(--muted)] hover:text-[var(--text)] md:min-h-8 md:min-w-8"
          onClick={async () => {
            try {
              await writeTextToClipboard(flow.userCode);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="lg" className="h-auto min-h-11 max-w-full gap-1.5 px-4 py-2 text-sm whitespace-normal md:min-h-10">
          <a href={flow.authorizationUrl} target="_blank" rel="noopener noreferrer">
            Open sign-in page
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 px-3 text-sm text-[var(--muted)] md:min-h-10"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-xs text-[var(--muted)]">
        <span className="inline-flex items-center gap-2" role="status">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Waiting for you to approve
        </span>
        <span className="tabular-nums">
          {remaining > 0 ? `Code expires in ${formatCountdown(remaining)}` : "Code expired"}
        </span>
      </div>
    </div>
  );
}

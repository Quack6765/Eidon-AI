"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { buildReleaseUrl } from "@/lib/release-highlights";

type WhatsNew = {
  version: string;
  autoOpen: boolean;
  bullets: string[];
};

let payloadRequest: Promise<WhatsNew | null> | null = null;

let dismissalRecorded = false;

const buildVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

function normalizeWhatsNew(value: unknown): WhatsNew | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { version?: unknown; autoOpen?: unknown; bullets?: unknown };
  if (typeof candidate.version !== "string" || !Array.isArray(candidate.bullets)) {
    return null;
  }

  const bullets = candidate.bullets.filter(
    (bullet): bullet is string => typeof bullet === "string" && bullet.trim().length > 0
  );

  if (bullets.length === 0) {
    return null;
  }

  return {
    version: candidate.version,
    autoOpen: candidate.autoOpen === true,
    bullets
  };
}

async function requestWhatsNew(): Promise<WhatsNew | null> {
  try {
    const response = await fetch("/api/whats-new", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { whatsNew?: unknown };
    return normalizeWhatsNew(body?.whatsNew);
  } catch {
    return null;
  }
}

function loadWhatsNew(): Promise<WhatsNew | null> {
  if (!payloadRequest) {
    payloadRequest = requestWhatsNew();
  }

  return payloadRequest;
}

function recordDismissal() {
  if (dismissalRecorded) {
    return;
  }

  dismissalRecorded = true;

  try {
    void fetch("/api/whats-new", { method: "POST" }).catch(() => undefined);
  } catch {
    return;
  }
}

function useWhatsNewPayload() {
  const [payload, setPayload] = useState<WhatsNew | null>(null);
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    let isActive = true;

    void loadWhatsNew().then((next) => {
      if (!isActive) {
        return;
      }

      setPayload(next);
      setIsResolved(true);
    });

    return () => {
      isActive = false;
    };
  }, []);

  return { payload, isResolved };
}

export function WhatsNewDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { payload, isResolved } = useWhatsNewPayload();

  if (!isResolved || !payload) {
    return null;
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      recordDismissal();
    }

    onOpenChange(nextOpen);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title="What's new"
      description={
        <span className="text-[12.5px] font-medium tracking-[0.04em] text-white/55 tabular-nums">
          {payload.version}
        </span>
      }
      size="md"
      titleClassName="text-[27px] leading-tight"
      icon={
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--accent)]">
          <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" />
        </div>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <a
            href={buildReleaseUrl(payload.version)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-1 py-1 text-[13px] font-medium text-primary underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45"
          >
            Read the detailed changelog
          </a>
          <Button
            type="button"
            autoFocus
            className="min-h-11 rounded-full px-6 focus-visible:border-[var(--accent)]/40 focus-visible:ring-[var(--accent)]/40"
            onClick={() => handleOpenChange(false)}
          >
            Got it
          </Button>
        </div>
      }
    >
      <ul
        tabIndex={0}
        className="flex flex-col gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/40"
      >
        {payload.bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-2.5 text-[15.5px] leading-[26px] text-[var(--text)]"
          >
            <span
              className="mt-[10.5px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--accent)]"
              aria-hidden="true"
            />
            <span className="min-w-0">{bullet}</span>
          </li>
        ))}
      </ul>
    </DialogShell>
  );
}

export function WhatsNewAutoDialog() {
  const [payload, setPayload] = useState<WhatsNew | null>(null);

  useEffect(() => {
    let isActive = true;

    void loadWhatsNew().then((next) => {
      if (isActive && next?.autoOpen) {
        setPayload(next);
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  if (!payload) {
    return null;
  }

  return (
    <WhatsNewDialog
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setPayload(null);
        }
      }}
    />
  );
}

export function WhatsNewVersionButton() {
  const { payload } = useWhatsNewPayload();
  const [open, setOpen] = useState(false);

  if (!payload) {
    return (
      <p className="mt-2.5 text-[11px] font-medium text-white/45 tracking-[0.04em] tabular-nums">
        {buildVersion}
      </p>
    );
  }

  return (
    <>
      <div className="mt-1.5">
        <button
          type="button"
          title="What's new"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="-mx-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-white/45 tracking-[0.04em] tabular-nums transition-colors duration-200 hover:bg-white/[0.04] hover:text-white/75 focus-visible:bg-white/[0.04] focus-visible:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45"
        >
          {buildVersion}
        </button>
      </div>
      <WhatsNewDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

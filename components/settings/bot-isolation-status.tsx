import type { IsolationStatus } from "@/lib/shell-isolation";

const STATUS_COPY: Record<IsolationStatus, { label: string; dotClass: string; description: string }> = {
  active: {
    label: "Active",
    dotClass: "bg-emerald-400",
    description:
      "Bot commands and the browser can only use their own files, and their web traffic goes through Eidon's filter, which blocks this server and your local network."
  },
  filesystem: {
    label: "Files only",
    dotClass: "bg-amber-400",
    description:
      "Bot commands and the browser can only use their own files. This server's Linux kernel is older than 6.7, so bots could still reach this server and your local network directly."
  },
  unavailable: {
    label: "Unavailable",
    dotClass: "bg-red-400",
    description:
      "This server's kernel doesn't support Landlock, so bot commands and the browser run without a sandbox and could read Eidon's data. Web traffic still goes through Eidon's filter, but a bot could bypass it."
  }
};

export function BotIsolationStatus({ status }: { status: IsolationStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <div className="rounded-xl border border-white/6 bg-white/4 px-4 py-3 sm:max-w-md" data-testid="bot-isolation-status">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--text)]">Bot sandbox</div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[var(--muted)]">
          <span className={`h-1.5 w-1.5 rounded-full ${copy.dotClass}`} aria-hidden="true" />
          {copy.label}
        </span>
      </div>
      <div className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{copy.description}</div>
    </div>
  );
}

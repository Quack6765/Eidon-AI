import type { ReactNode } from "react";

/**
 * Standardized footer action bar for a settings detail editor plane.
 *
 * Owns the status dot so its color and label cannot drift:
 *   unsaved → amber dot + "Unsaved changes"
 *   saving  → amber dot + "Saving…"
 *   saved   → emerald dot + "All changes saved"
 *
 * Renders only the inner `flex min-h-11 … justify-between` row. It is always
 * passed to `SettingsSplitPane`'s `detailFooter` slot, which already provides
 * the pinned `border-t … backdrop-blur-md` container — do not duplicate it.
 *
 * Layout: `[status | leftActions] … [rightActions]` where rightActions is the
 * commit cluster (`[Test?] [Discard] [Save]`) and leftActions holds scoped /
 * destructive controls (e.g. Delete) that sit after the status dot.
 */
export function DetailActionBar({
  status,
  leftActions,
  rightActions
}: {
  status?: "unsaved" | "saving" | "saved" | null;
  leftActions?: ReactNode;
  rightActions?: ReactNode;
}) {
  let statusBlock: ReactNode = null;
  if (status === "unsaved" || status === "saving") {
    statusBlock = (
      <span className="flex items-center gap-2 text-xs text-amber-300/85">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        {status === "saving" ? "Saving…" : "Unsaved changes"}
      </span>
    );
  } else if (status === "saved") {
    statusBlock = (
      <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        All changes saved
      </span>
    );
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {statusBlock}
        {leftActions}
      </div>
      {rightActions ? (
        <div className="flex flex-wrap items-center gap-2">{rightActions}</div>
      ) : null}
    </div>
  );
}

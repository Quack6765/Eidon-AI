import type { ReactNode } from "react";

/**
 * Standardized header for a settings detail editor plane.
 *
 * Renders an optional breadcrumb row, then a flex row of
 * `[title + badge + summary] … [globalToggle | actions]`. The breadcrumb is
 * omitted by default — the three-pane layout plus the mobile named-back bar
 * already supply context. Pass `divided` to draw a hairline beneath the header.
 */
export function DetailHeader({
  title,
  summary,
  badge,
  globalToggle,
  actions,
  breadcrumb,
  divided = false
}: {
  title: string;
  summary?: string;
  badge?: ReactNode;
  globalToggle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  divided?: boolean;
}) {
  return (
    <div className={divided ? "border-b border-white/[0.06] pb-6" : "pb-5"}>
      {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
            {badge}
          </div>
          {summary ? (
            <p className="mt-1 text-xs text-[var(--muted)]">{summary}</p>
          ) : null}
        </div>
        {globalToggle || actions ? (
          <div className="flex items-center gap-2">
            {globalToggle}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

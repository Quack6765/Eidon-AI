import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

export function SettingsMenuItem({
  icon: Icon,
  title,
  description,
  isActive,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 ${
        isActive
          ? "border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--text)]"
          : "border-white/[0.04] text-white/70 hover:border-white/[0.08] hover:bg-white/[0.035] hover:text-white"
      }`}
      aria-current={isActive ? "page" : undefined}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
          isActive
            ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]"
            : "border-white/[0.05] bg-white/[0.025] text-white/50 group-hover:text-white/75"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-5">{title}</span>
        {description ? (
          <span className="mt-0.5 block truncate text-xs leading-4 text-white/50">
            {description}
          </span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/25 md:hidden" />
    </button>
  );
}

import type { PropsWithChildren } from "react";

export function Label({ children }: PropsWithChildren) {
  return (
    <span className="mb-2 block text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
      {children}
    </span>
  );
}

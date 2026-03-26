import type { PropsWithChildren } from "react";

export function Label({ children }: PropsWithChildren) {
  return (
    <span className="mb-2 block text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--muted)]">
      {children}
    </span>
  );
}

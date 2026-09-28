"use client";

import { Check } from "lucide-react";

export function DoneStep({ summary }: { summary: string[] }) {
  return (
    <ul className="mx-auto flex max-w-[42ch] flex-col gap-2.5">
      {summary.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-[var(--text)]">
          <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

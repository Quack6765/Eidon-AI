"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import type { MemoryRigor } from "@/lib/types";

export type MemoryPreferences = {
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  memoriesRigor: MemoryRigor;
};

export const RIGOR_OPTIONS: Array<{ value: MemoryRigor; label: string; description: string }> = [
  { value: "low", label: "Low", description: "Only saves when you explicitly ask." },
  { value: "balanced", label: "Balanced", description: "Proactively saves durable facts (name, location, role, preferences)." },
  { value: "high", label: "High", description: "Captures broadly, including implied and stated personal context." }
];

export function MemoryPreferencesSettings({
  preferences,
  dirty,
  onChange
}: {
  preferences: MemoryPreferences;
  dirty: boolean;
  onChange: (patch: Partial<MemoryPreferences>) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 sm:max-w-md">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">Enable memories</div>
          <div className="mt-0.5 text-xs leading-5 text-[var(--muted)]">Save and recall facts across conversations</div>
        </div>
        <label className="relative inline-flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            aria-label="Enable memories"
            checked={preferences.memoriesEnabled}
            onChange={(event) => onChange({ memoriesEnabled: event.target.checked })}
            className="peer sr-only"
          />
          <span className={`h-6 w-11 rounded-full bg-white/10 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-violet-500/60 peer-checked:after:translate-x-full ${dirty ? "ring-1 ring-amber-500/40" : ""}`} />
        </label>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="memories-max-count" className={fieldLabel}>Maximum memories</label>
          <p className="mb-2 text-xs leading-5 text-[var(--muted)]">New memories are not saved once this limit is reached.</p>
          <input
            id="memories-max-count"
            type="number"
            min={1}
            max={500}
            value={preferences.memoriesMaxCount}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              if (value >= 1 && value <= 500) onChange({ memoriesMaxCount: value });
            }}
            className={`${selectLike} w-full ${dirty ? "!border-amber-500/40" : ""}`}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <label htmlFor="memories-rigor" className={`${fieldLabel} mb-0`}>Memory proactiveness</label>
            <Popover open={helpOpen} onOpenChange={setHelpOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="What each proactiveness level does"
                  onPointerEnter={(event) => { if (event.pointerType === "mouse") setHelpOpen(true); }}
                  onPointerLeave={(event) => { if (event.pointerType === "mouse") setHelpOpen(false); }}
                  className="text-sky-400 transition-colors hover:text-sky-300 focus:outline-none"
                >
                  <CircleHelp className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={6} className="max-w-[17rem]">
                <div className="space-y-1.5 py-0.5">
                  {RIGOR_OPTIONS.map((option) => (
                    <div key={option.value} className="leading-snug">
                      <span className="font-semibold">{option.label}</span>
                      <span className="opacity-70">: {option.description}</span>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <p className="mb-2 text-xs leading-5 text-[var(--muted)]">How readily the assistant saves new facts on its own.</p>
          <select
            id="memories-rigor"
            value={preferences.memoriesRigor}
            onChange={(event) => onChange({ memoriesRigor: event.target.value as MemoryRigor })}
            className={`${selectLike} w-full ${dirty ? "!border-amber-500/40" : ""}`}
          >
            {RIGOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

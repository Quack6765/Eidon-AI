import { inputLike } from "@/lib/settings-styles";
import type { CredentialAction } from "@/lib/integration-types";

export function CredentialField({
  id,
  label,
  optional = false,
  value,
  action,
  stored,
  dirty,
  onChange
}: {
  id: string;
  label: string;
  optional?: boolean;
  value: string;
  action: CredentialAction;
  stored: boolean;
  dirty?: boolean;
  onChange(value: string, action: CredentialAction): void;
}) {
  const preservingStored = stored && action === "preserve";
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-medium text-[var(--text)]">
        {label}
      </label>
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <input
          id={id}
          aria-label={label}
          type="password"
          autoComplete="off"
          value={value}
          placeholder={preservingStored ? "••••••••" : optional ? "Optional" : "Required"}
          onChange={(event) => onChange(
            event.target.value,
            event.target.value.trim() ? "replace" : "clear"
          )}
          className={`${inputLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
        />
        {preservingStored ? (
          <button
            type="button"
            onClick={() => onChange("", "clear")}
            className="rounded-lg px-2.5 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
          >
            Clear stored key
          </button>
        ) : null}
      </div>
      {stored && action !== "preserve" ? (
        <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-300">
          <span>{value.trim() ? "A replacement key will be saved." : "Stored key will be cleared when you save."}</span>
          <button
            type="button"
            onClick={() => onChange("", "preserve")}
            className="font-medium text-[var(--text)] underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
          >
            Keep stored key
          </button>
        </div>
      ) : null}
    </div>
  );
}

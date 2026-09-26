"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { Badge } from "@/components/settings/badge";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import type { SavedLogin } from "@/lib/saved-logins";
import { fieldLabel } from "@/lib/settings-styles";

function siteName(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SavedLoginsSettings({ active = true }: { active?: boolean }) {
  const [savedLogins, setSavedLogins] = useState<SavedLogin[]>([]);
  const toast = useToastState();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/saved-logins");
      if (!response.ok) return;
      const data = (await response.json()) as { savedLogins?: SavedLogin[] };
      setSavedLogins(Array.isArray(data.savedLogins) ? data.savedLogins : []);
    } catch {
      setSavedLogins([]);
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  async function remove(login: SavedLogin) {
    try {
      const response = await fetch(`/api/saved-logins/${encodeURIComponent(login.id)}`, { method: "DELETE" });
      if (!response.ok) {
        toast.showToast("error", "Failed to remove the saved login.");
        return;
      }
      await refresh();
      toast.showToast("success", "Saved login removed.");
    } catch {
      toast.showToast("error", "Failed to remove the saved login.");
    }
  }

  return (
    <div className="space-y-3" data-testid="saved-logins">
      <div className="space-y-1.5">
        <p className={fieldLabel}>Saved logins</p>
        <p className="text-xs leading-5 text-[var(--muted)]">
          Secrets you saved when a bot asked for them. Bots fill them only on the same site, without asking. Remove one to be
          asked again.
        </p>
      </div>
      {savedLogins.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
            <KeyRound className="h-4 w-4 text-[var(--muted)]" />
          </div>
          <p className="text-xs text-[var(--muted)]">
            No saved logins yet. Tick &quot;Save it&quot; when a bot asks you for a password.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {savedLogins.map((login) => (
            <div key={login.id} className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1 rounded-xl border border-white/[0.04] px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-[#f4f4f5]">{siteName(login.origin)}</span>
                  <Badge variant="violet">{login.label}</Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  Saved {formatDate(login.updatedAt)}
                  {login.lastUsedAt ? ` · last filled ${formatDate(login.lastUsedAt)}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove the saved ${login.label} for ${siteName(login.origin)}`}
                onClick={() => void remove(login)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.06] hover:text-[var(--text)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Toast visible={toast.visible} variant={toast.variant} message={toast.message} />
    </div>
  );
}

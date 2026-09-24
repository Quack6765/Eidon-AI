"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/settings/badge";
import { Toast } from "@/components/ui/toast";
import { useToastState } from "@/hooks/use-toast-state";
import { fieldLabel, inputLike } from "@/lib/settings-styles";
import type { ToolApprovalRule } from "@/lib/types";

export function ToolApprovalRulesSettings({ active = true }: { active?: boolean }) {
  const [rules, setRules] = useState<ToolApprovalRule[]>([]);
  const [allowAll, setAllowAll] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const toast = useToastState();

  const refreshRules = useCallback(async () => {
    try {
      const response = await fetch("/api/tool-approvals");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { allowAll?: boolean; rules?: ToolApprovalRule[] };
      setAllowAll(Boolean(data.allowAll));
      setRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      setRules([]);
    }
  }, []);

  useEffect(() => {
    if (active) {
      void refreshRules();
    }
  }, [active, refreshRules]);

  async function toggleAllowAll(next: boolean) {
    try {
      const response = await fetch("/api/tool-approvals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowAll: next })
      });

      if (!response.ok) {
        toast.showToast("error", "Failed to update tool approval settings.");
        return;
      }

      setAllowAll(next);
      toast.showToast("success", next ? "All tools allowed." : "Approval prompts restored.");
    } catch {
      toast.showToast("error", "Failed to update tool approval settings.");
    }
  }

  async function addRule() {
    const text = newRule.trim();
    if (!text) {
      return;
    }

    setIsAdding(true);
    setAddError("");

    try {
      const response = await fetch("/api/tool-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setAddError(data?.error ?? "Failed to add tool approval.");
        return;
      }

      setNewRule("");
      await refreshRules();
      toast.showToast("success", "Tool approval added.");
    } catch {
      setAddError("Failed to add tool approval.");
    } finally {
      setIsAdding(false);
    }
  }

  async function revokeRule(rule: ToolApprovalRule) {
    try {
      const response = await fetch(`/api/tool-approvals/${rule.id}`, { method: "DELETE" });
      if (!response.ok) {
        toast.showToast("error", "Failed to revoke tool approval.");
        return;
      }
      await refreshRules();
      toast.showToast("success", "Tool approval revoked.");
    } catch {
      toast.showToast("error", "Failed to revoke tool approval.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 sm:max-w-md">
        <div className="text-sm font-medium text-[var(--text)]">Allow all tools</div>
        <label className="relative inline-flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            aria-label="Allow all tools"
            checked={allowAll}
            onChange={(event) => void toggleAllowAll(event.target.checked)}
            className="peer sr-only"
          />
          <span className="h-6 w-11 rounded-full bg-white/10 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-violet-500/60 peer-checked:after:translate-x-full" />
        </label>
      </div>
      {!allowAll ? (
        <>
      <div className="space-y-1.5">
        <p className={fieldLabel}>Allowed tool families</p>
        <p className="text-xs leading-5 text-[var(--muted)]">
          Commands and MCP tools you chose to always allow. Remove an entry to require approval again.
        </p>
      </div>
      <div className="space-y-1.5">
        <p className={fieldLabel}>Allow a command</p>
        <p className="text-xs leading-5 text-[var(--muted)]">
          &quot;git&quot; allows every git command with any arguments. &quot;git checkout&quot; allows git
          checkout with any arguments, but not git restore.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newRule}
            onChange={(event) => {
              setNewRule(event.target.value);
              setAddError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void addRule();
              }
            }}
            placeholder="git checkout"
            className={`${inputLike} flex-1`}
          />
          <button
            type="button"
            onClick={() => void addRule()}
            disabled={isAdding || !newRule.trim()}
            className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-[var(--accent)] px-4 text-[13px] font-medium text-white shadow-[0_0_20px_var(--accent-glow)] transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 disabled:shadow-none disabled:opacity-40"
          >
            {isAdding ? "Adding…" : "Add"}
          </button>
        </div>
        {addError ? <p className="text-xs text-red-300">{addError}</p> : null}
      </div>
      <div className="space-y-1.5">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
              <ShieldCheck className="h-4 w-4 text-[var(--muted)]" />
            </div>
            <p className="text-xs text-[var(--muted)]">
              No standing approvals yet. Choose &quot;Allow always&quot; on a tool request to add one.
            </p>
          </div>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1 rounded-xl border border-white/[0.04] px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-[#f4f4f5]">{rule.family}</span>
                  <Badge variant={rule.scope === "shell" ? "http" : "violet"}>
                    {rule.scope === "shell" ? "Command" : "MCP tool"}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {rule.scope === "shell"
                    ? `Every "${rule.family}" command, whatever its arguments`
                    : `Every call of the "${rule.family}" MCP tool`}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Revoke ${rule.family}`}
                onClick={() => void revokeRule(rule)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.06] hover:text-[var(--text)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
        </>
      ) : null}
      <Toast visible={toast.visible} variant={toast.variant} message={toast.message} />
    </div>
  );
}

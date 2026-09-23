"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/settings/badge";
import { useToastState } from "@/hooks/use-toast-state";
import { fieldLabel } from "@/lib/settings-styles";
import type { ToolApprovalRule } from "@/lib/types";

export function ToolApprovalRulesSettings({ active = true }: { active?: boolean }) {
  const [rules, setRules] = useState<ToolApprovalRule[]>([]);
  const toast = useToastState();

  const refreshRules = useCallback(async () => {
    try {
      const response = await fetch("/api/tool-approvals");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { rules?: ToolApprovalRule[] };
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
      <div className="space-y-1.5">
        <p className={fieldLabel}>Allowed tool families</p>
        <p className="text-xs leading-5 text-[var(--muted)]">
          Commands and MCP tools you chose to always allow. Remove an entry to require approval again.
        </p>
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
    </div>
  );
}

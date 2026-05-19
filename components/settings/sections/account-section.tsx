"use client";

import { type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import type { AuthUser } from "@/lib/types";
import { useToastState } from "@/hooks/use-toast-state";

export function AccountSection({ user }: { user: AuthUser }) {
  const router = useRouter();
  const toast = useToastState();
  const isEnvManaged = user.passwordManagedBy === "env";

  async function handleAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toast.dismissToast();
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(formData.get("username") ?? ""),
        password: String(formData.get("password") ?? "")
      })
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      toast.showToast("error", result.error ?? "Unable to update account");
      return;
    }
    toast.showToast("success", "Account updated. Sign in again if you changed the password.");
    router.refresh();
  }

  const fieldLabel = "block text-[13px] font-medium text-[var(--muted)] mb-1.5";
  const inputLike = "w-full rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/40 focus:bg-white/6 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
  const selectLike = `${inputLike} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10`;
  const sectionTitle = "text-sm font-semibold text-[var(--text)]";
  const sectionDivider = "border-t border-white/[0.06]";

  return (
    <div className="w-full max-w-none space-y-6 p-6 md:max-w-[55%] md:p-8">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <p className={sectionTitle}>Account</p>
            <h2
              className="mt-1 text-2xl leading-none text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {isEnvManaged ? "Environment-managed access" : "Local access"}
            </h2>
          </div>
        </div>

        {isEnvManaged ? (
          <div className="space-y-4">
            <div>
              <label className={fieldLabel}>Username</label>
              <Input value={user.username} readOnly disabled />
            </div>
            <div className="rounded-2xl border border-amber-300/12 bg-amber-300/8 px-4 py-4 text-sm leading-6 text-amber-100/90">
              Login credentials for this account are managed by environment variables and cannot
              be changed here.
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void handleAccount(event)} className="space-y-6">
            <div className="space-y-3">
              <div>
                <label className={fieldLabel}>Username</label>
                <Input name="username" defaultValue={user.username} />
              </div>
              <div>
                <label className={fieldLabel}>New password</label>
                <Input
                  name="password"
                  type="password"
                  placeholder="Enter a new password"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" className="px-3 py-1.5 text-xs">
                Save
              </Button>
            </div>
          </form>
        )}
      </div>

      <Toast
        visible={toast.visible}
        variant={toast.variant}
        message={toast.message}
      />
    </div>
  );
}

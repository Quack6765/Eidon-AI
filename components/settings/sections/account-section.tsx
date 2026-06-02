"use client";

import { type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import type { AuthUser } from "@/lib/types";
import { fieldLabel, sectionTitle } from "@/lib/settings-styles";
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

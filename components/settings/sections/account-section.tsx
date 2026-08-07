"use client";

import { type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";

import { DetailHeader } from "@/components/settings/detail-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import type { AuthUser } from "@/lib/types";
import { fieldLabel } from "@/lib/settings-styles";
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
    <div className="h-full w-full max-w-[760px] space-y-6 overflow-y-auto px-5 py-6 sm:px-7 md:px-9 md:py-8">
      <div className="space-y-6">
        <DetailHeader
          title={isEnvManaged ? "Environment-managed access" : "Local access"}
          summary="Manage your sign-in credentials for this workspace."
          badge={
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
              <Shield className="h-4 w-4" />
            </div>
          }
        />

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
              <Button type="submit" size="lg" className="min-h-11 px-5 text-sm md:min-h-10">
                Save changes
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

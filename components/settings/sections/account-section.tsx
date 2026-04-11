"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthUser } from "@/lib/types";

export function AccountSection({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");
  const isEnvManaged = user.passwordManagedBy === "env";

  async function handleAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAccountSuccess("");
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
      setError(result.error ?? "Unable to update account");
      return;
    }
    setAccountSuccess("Account updated. Sign in again if you changed the password.");
    router.refresh();
  }

  return (
    <div className="w-full max-w-none space-y-6 p-6 md:max-w-[55%] md:p-8">
      <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300">
              Account
            </p>
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
              <Label>Username</Label>
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
                <Label>Username</Label>
                <Input name="username" defaultValue={user.username} />
              </div>
              <div>
                <Label>New password</Label>
                <Input
                  name="password"
                  type="password"
                  placeholder="Enter a new password"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Button type="submit" variant="secondary">
                Update account
              </Button>
              {accountSuccess ? (
                <div className="flex items-center gap-1.5 text-sm text-emerald-400">
                  <Check className="h-3.5 w-3.5" />
                  {accountSuccess}
                </div>
              ) : null}
            </div>
          </form>
        )}
      </div>

      {error ? (
        <div className="rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shield, LogOut, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthUser } from "@/lib/types";

export function AccountSection({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [isPending] = useTransition();
  const [error, setError] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="max-w-[55%] p-6 md:p-8 space-y-6">
      <form
        onSubmit={(event) => void handleAccount(event)}
        className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-6"
      >
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
              Local access
            </h2>
          </div>
        </div>

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
              placeholder="Leave blank to keep current password"
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

      <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-300">
            <LogOut className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-300">
              Session
            </p>
            <h2
              className="mt-1 text-2xl leading-none text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Sign out
            </h2>
          </div>
        </div>

        <p className="text-sm leading-6 text-[var(--muted)]">
          End the current local session and return to the login screen.
        </p>

        <Button type="button" variant="danger" onClick={logout} disabled={isPending}>
          Sign out
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}

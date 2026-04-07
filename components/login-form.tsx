"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, LoaderCircle } from "lucide-react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsPending(true);
    const formData = new FormData(event.currentTarget);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: String(formData.get("username") ?? ""),
        password: String(formData.get("password") ?? "")
      })
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Unable to sign in");
      setIsPending(false);
      return;
    }

    window.location.assign("/");
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="relative z-10 mx-auto flex w-full max-w-[420px] flex-col gap-7 rounded-2xl border border-white/6 bg-white/[0.03] backdrop-blur-xl px-8 py-10 shadow-[var(--shadow)] animate-slide-up"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white text-sm font-bold shadow-[0_0_16px_var(--accent-glow)]">
            E
          </div>
          <span
            className="text-3xl text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Eidon
          </span>
        </div>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          A private conversational workspace with streaming, visible thinking, and long-memory compaction.
        </p>
      </div>

      <div className="space-y-3">
        <Input name="username" placeholder="Username" autoComplete="username" required />
        <Input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          required
        />
      </div>

      {error ? (
        <div className="rounded-lg bg-red-500/8 border border-red-400/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full h-11 gap-2">
        {isPending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Enter workspace
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wordmark } from "@/components/ui/wordmark";
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
      className="relative z-10 mx-auto flex w-full max-w-[420px] flex-col gap-7 overflow-hidden rounded-2xl border border-white/6 bg-white/[0.03] backdrop-blur-xl shadow-[var(--shadow)] animate-slide-up pt-10"
    >
      <div className="flex flex-col items-center gap-3">
        <div aria-hidden="true" className="flex items-center justify-center gap-3">
          <img src="/bots/bot-teal.svg" alt="" width={64} height={64} />
          <img src="/bots/bot-violet.svg" alt="" width={64} height={64} />
          <img src="/bots/bot-pink.svg" alt="" width={64} height={64} />
        </div>
        <Wordmark className="block px-8 text-center text-[48px]" />
      </div>

      <div className="space-y-3 px-8">
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
        <div className="rounded-lg bg-red-500/8 border border-red-400/10 px-4 py-2.5 text-sm text-red-300 mx-8">
          {error}
        </div>
      ) : null}

      <div className="px-8 pb-10">
        <Button type="submit" disabled={isPending} className="w-full h-11 gap-2">
          {isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Proceed
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      className="panel grain relative mx-auto flex w-full max-w-md flex-col gap-6 overflow-hidden rounded-[2rem] border px-8 py-10"
    >
      <div className="space-y-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.35em] text-[color:var(--accent)]">
          Private Console
        </p>
        <h1
          className="text-5xl leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Hermes
        </h1>
        <p className="text-sm leading-6 text-[color:var(--muted)]">
          A self-hosted conversational workspace with streaming responses, visible thinking,
          and long-memory compaction.
        </p>
      </div>

      <div className="space-y-4">
        <Input name="username" placeholder="Username" autoComplete="username" required />
        <Input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          required
        />
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Entering..." : "Enter workspace"}
      </Button>
    </form>
  );
}

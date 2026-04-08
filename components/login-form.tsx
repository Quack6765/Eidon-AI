"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
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
      className="relative z-10 mx-auto flex w-full max-w-[420px] flex-col gap-7 overflow-hidden rounded-2xl border border-white/6 bg-white/[0.03] backdrop-blur-xl shadow-[var(--shadow)] animate-slide-up"
    >
      <div className="relative w-full">
        <Image
          src="/eidon-banner.png"
          alt="Eidon"
          width={1024}
          height={445}
          priority
          unoptimized
          className="w-full block"
        />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--background)] to-transparent" />
      </div>
      <span
        className="block text-center font-bold tracking-[0.12em] leading-none text-[48px] px-8"
        style={{
          fontFamily: "var(--font-wordmark), 'Eurostile', 'Space Grotesk', sans-serif",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundImage: "linear-gradient(to bottom, #FFFFFF 0%, #D4C8FF 40%, #8b5cf6 100%)",
          filter: "drop-shadow(0 0 8px rgba(139,92,246,0.5)) drop-shadow(0 0 20px rgba(139,92,246,0.25)) drop-shadow(0 0 36px rgba(139,92,246,0.12))",
        }}
      >
        Eidon
      </span>
      <p className="text-sm leading-relaxed text-[var(--muted)] px-8">
        A private conversational workspace with streaming, visible thinking, and long-memory compaction.
      </p>

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
              Enter workspace
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { Shell } from "@/components/shell";
import { ArrowUp, Sparkles, BookOpen, Code2, Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import type { Conversation, Folder } from "@/lib/types";

const SUGGESTIONS = [
  { icon: Lightbulb, label: "Help me brainstorm ideas", color: "text-amber-400/60" },
  { icon: Code2, label: "Write and debug code", color: "text-emerald-400/60" },
  { icon: BookOpen, label: "Explain a complex topic", color: "text-blue-400/60" },
  { icon: Sparkles, label: "Create something creative", color: "text-purple-400/60" }
];

export default function HomePage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    fetch("/api/conversations")
      .then((res) => res.json())
      .then((data) => {
        if (data.conversations) setConversations(data.conversations);
      })
      .catch(() => {});
    fetch("/api/folders")
      .then((res) => res.json())
      .then((data) => {
        if (data.folders) setFolders(data.folders);
      })
      .catch(() => {});
  }, []);

  async function handleCreate() {
    try {
      const response = await fetch("/api/conversations", { method: "POST" });
      const payload = (await response.json()) as { conversation: Conversation };
      window.location.href = `/chat/${payload.conversation.id}`;
    } catch (e) {}
  }

  return (
    <Shell conversations={conversations} folders={folders}>
      <main className="flex h-full min-h-screen flex-col items-center justify-center px-4 pb-8">
        <div className="animate-slide-up">
          <div className="text-center mb-10">
            <h2
              className="text-3xl md:text-4xl font-medium text-[var(--text)] mb-3"
              style={{ fontFamily: "var(--font-display)" }}
            >
              What&apos;s on your mind?
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Start a conversation or pick a suggestion below
            </p>
          </div>

          <div className="w-full max-w-[680px] mx-auto mb-10">
            <button
              onClick={handleCreate}
              className="group flex bg-[var(--panel)] w-full min-h-[56px] rounded-2xl items-center px-4 hover:bg-white/8 transition-all duration-300 cursor-text border border-white/6 shadow-[var(--shadow)] hover:border-white/10"
            >
              <Sparkles className="h-5 w-5 text-[var(--accent)] opacity-60" />
              <span className="ml-3 text-white/35 group-hover:text-white/50 transition-colors duration-300 text-base flex-1 text-left">
                Ask anything...
              </span>

              <div className="flex items-center gap-2">
                <div className="bg-[var(--accent)] text-white p-1.5 rounded-xl shadow-[0_0_12px_var(--accent-glow)] transition-all duration-300 group-hover:shadow-[0_0_20px_var(--accent-glow)]">
                  <ArrowUp className="h-4 w-4" />
                </div>
              </div>
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-w-[680px] w-full">
            {SUGGESTIONS.map((suggestion, i) => (
              <button
                key={i}
                onClick={handleCreate}
                className="group flex flex-col items-center gap-2.5 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-4 text-sm text-white/50 hover:bg-white/[0.04] hover:border-white/10 hover:text-white/70 transition-all duration-300"
                style={{ animationDelay: `${(i + 1) * 100}ms` }}
              >
                <suggestion.icon className={`h-5 w-5 ${suggestion.color} transition-transform duration-300 group-hover:scale-110`} />
                <span className="text-xs leading-tight text-center">{suggestion.label}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    </Shell>
  );
}

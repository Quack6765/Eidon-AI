"use client";

import { Shell } from "@/components/shell";
import { Plus, Mic, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { Conversation } from "@/lib/types";

export default function HomePage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    // In a real app we would pass these from server or fetch
    // We fetch so it works smoothly with our client component rewrite
    fetch("/api/conversations")
      .then((res) => res.json())
      .then((data) => {
        if (data.conversations) {
          setConversations(data.conversations);
        }
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
    <Shell conversations={conversations}>
      <main className="flex h-full min-h-screen flex-col items-center justify-center p-4">
        <h2 className="mb-8 text-2xl font-medium md:text-3xl text-[var(--text)]">
          What&apos;s on your mind today?
        </h2>
        
        {/* Fake input designed to mimic ChatGPT's empty state input */}
        <div className="w-full max-w-[700px] relative">
            <button 
              onClick={handleCreate}
              className="group flex bg-[#2f2f2f] w-full min-h-[56px] rounded-[1.8rem] items-center px-4 hover:bg-[#383838] transition cursor-text border border-white/5 shadow-lg"
            >
               <span className="text-white/40 group-hover:text-white/60 transition"><Plus className="h-5 w-5" /></span>
               <span className="ml-3 text-white/50 group-hover:text-white/70 transition text-base font-normal flex-1 text-left">Ask anything</span>
               
               <div className="flex items-center gap-2">
                 <div className="p-2 text-white/60 hover:text-white transition rounded-full hover:bg-white/10">
                   <Mic className="h-4 w-4" />
                 </div>
                 <div className="bg-[var(--accent)] text-white p-1.5 rounded-full">
                   <ArrowUp className="h-4 w-4" />
                 </div>
               </div>
            </button>
        </div>
      </main>
    </Shell>
  );
}

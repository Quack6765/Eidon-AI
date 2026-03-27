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
              className="group flex bg-white w-full min-h-[56px] rounded-[1.8rem] items-center px-4 hover:shadow-md transition cursor-text border border-gray-200 shadow-sm"
            >
               <span className="text-gray-400 group-hover:text-gray-600 transition"><Plus className="h-5 w-5" /></span>
               <span className="ml-3 text-gray-400 group-hover:text-gray-600 transition text-base font-normal flex-1 text-left">Ask anything</span>
               
               <div className="flex items-center gap-2">
                 <div className="p-2 text-gray-400 hover:text-gray-600 transition rounded-full hover:bg-gray-100">
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

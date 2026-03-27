"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Plus, 
  Search, 
  Settings,
  MoreHorizontal
} from "lucide-react";

import { formatTimestamp } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

export function Sidebar({
  conversations,
  onClose
}: {
  conversations: Conversation[];
  onClose?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleCreate() {
    const response = await fetch("/api/conversations", { method: "POST" });
    const payload = (await response.json()) as { conversation: Conversation };
    router.push(`/chat/${payload.conversation.id}`);
    router.refresh();
    if (onClose) onClose();
  }

  return (
    <aside className="no-scrollbar flex h-full w-full flex-col bg-[var(--sidebar)] text-gray-800 border-r border-[var(--line)]">
      <div className="flex h-full flex-col px-3 py-3">
        {/* Top Header */}
        <div className="flex items-center justify-between mb-2 mt-1">
          <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5 transition font-semibold text-[var(--text)] text-sm">
            <img src="/logo.png" alt="Logo" width={24} height={24} className="h-6 w-auto object-contain" />
            <span>Hermes</span>
          </button>
          
          <div className="flex gap-1">
             <button 
               onClick={handleCreate} 
               className="p-1.5 rounded-lg text-gray-500 hover:bg-black/5 hover:text-[var(--text)] transition"
               title="New chat"
             >
               <Plus className="h-5 w-5" />
             </button>
          </div>
        </div>

        {/* Global actions */}
        <div className="flex flex-col gap-1 mb-4">
          <button className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-black/5 hover:text-gray-900 transition">
             <Search className="h-4 w-4" />
             <span>Search chats</span>
          </button>
        </div>

        {/* Scrollable Nav Area */}
        <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden pr-2 -mr-2 space-y-6">
           
           <div>
             <h3 className="px-2 pb-2 text-xs font-semibold text-gray-500">Folders</h3>
             <div className="flex flex-col gap-1">
               <button className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-black/5 hover:text-gray-900 transition">
                 <div className="h-4 w-4 border border-dashed border-gray-400 rounded-sm flex items-center justify-center">
                   <Plus className="h-3 w-3" />
                 </div>
                 <span>New folder</span>
               </button>
             </div>
           </div>

           <div>
             <h3 className="px-2 pb-2 text-xs font-semibold text-gray-500">Your chats</h3>
             <div className="flex flex-col">
               {conversations.map((conversation) => {
                 const active = pathname === `/chat/${conversation.id}`;

                 return (
                   <Link
                     key={conversation.id}
                     href={`/chat/${conversation.id}`}
                     onClick={onClose}
                     className={`group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition ${
                       active
                         ? "bg-black/5 text-gray-900 font-medium"
                         : "text-gray-600 hover:bg-black/5 hover:text-gray-900"
                     }`}
                   >
                     <div className="relative min-w-0 flex-1 overflow-hidden">
                       <div className={`truncate ${active ? "pr-8" : "group-hover:pr-8"}`}>
                         {conversation.title}
                       </div>
                       
                       {/* Floating Options Button on Hover/Active */}
                       <div className={`absolute right-0 top-0 bottom-0 flex items-center bg-gradient-to-l from-[var(--sidebar)] via-[var(--sidebar)] to-transparent pl-4 pr-1 ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                           <button className="text-gray-400 hover:text-gray-800 transition p-1">
                             <MoreHorizontal className="h-4 w-4" />
                           </button>
                       </div>
                     </div>
                   </Link>
                 );
               })}

               {!conversations.length ? (
                 <div className="px-2 py-3 text-xs text-gray-500 italic">
                   No conversations
                 </div>
               ) : null}
             </div>
           </div>
        </div>

        {/* Bottom User / Settings profile area */}
        <div className="mt-2 flex items-center border-t border-[var(--line)] pt-3 mb-1">
          <Link 
             href="/settings"
             onClick={onClose}
             className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-black/5 hover:text-gray-900 transition"
          >
             <Settings className="h-4 w-4" />
             <span>Settings</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}

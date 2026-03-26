import type { PropsWithChildren } from "react";

import { Sidebar } from "@/components/sidebar";
import type { Conversation } from "@/lib/types";

export function Shell({
  conversations,
  children
}: PropsWithChildren<{ conversations: Conversation[] }>) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1680px] gap-5 px-4 py-4 md:px-6 md:py-6">
      <Sidebar conversations={conversations} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

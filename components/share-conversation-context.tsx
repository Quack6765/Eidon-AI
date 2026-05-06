"use client";

import { createContext, useContext, type ReactNode } from "react";

export type ShareConversationControl = {
  canShare: boolean;
  openShareModal: () => void;
};

const ShareConversationContext = createContext<ShareConversationControl>({
  canShare: false,
  openShareModal: () => undefined
});

export function ShareConversationProvider({
  value,
  children
}: {
  value: ShareConversationControl;
  children?: ReactNode;
}) {
  return (
    <ShareConversationContext.Provider value={value}>
      {children}
    </ShareConversationContext.Provider>
  );
}

export function useShareConversation() {
  return useContext(ShareConversationContext);
}

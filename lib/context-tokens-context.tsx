"use client";

import React, { createContext, useContext, useMemo } from "react";

type ContextTokensMap = Record<string, number>;
type ContextTokensContextValue = {
  getTokenUsage: (conversationId: string) => number | null;
  setTokenUsage: (conversationId: string, tokens: number) => void;
};

const ContextTokensContext = createContext<ContextTokensContextValue | null>(null);

// Global store to persist across remounts
const globalTokensStore: ContextTokensMap = {};

export function ContextTokensProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<ContextTokensContextValue>(
    () => ({
      getTokenUsage: (conversationId) => globalTokensStore[conversationId] ?? null,
      setTokenUsage: (conversationId, tokens) => {
        globalTokensStore[conversationId] = tokens;
      }
    }),
    []
  );

  return <ContextTokensContext.Provider value={value}>{children}</ContextTokensContext.Provider>;
}

export function useContextTokens() {
  const context = useContext(ContextTokensContext);
  if (!context) {
    throw new Error("useContextTokens must be used within a ContextTokensProvider");
  }
  return context;
}
"use client";

import React, { createContext, useContext, useCallback } from "react";

type ContextTokensMap = Record<string, number>;
type ContextTokensContextValue = {
  getTokenUsage: (conversationId: string) => number | null;
  setTokenUsage: (conversationId: string, tokens: number) => void;
};

const ContextTokensContext = createContext<ContextTokensContextValue | null>(null);

// Global store to persist across remounts
const globalTokensStore: ContextTokensMap = {};

export function ContextTokensProvider({ children }: { children: React.ReactNode }) {
  const getTokenUsage = useCallback((conversationId: string): number | null => {
    return globalTokensStore[conversationId] ?? null;
  }, []);

  const setTokenUsage = useCallback((conversationId: string, tokens: number) => {
    globalTokensStore[conversationId] = tokens;
  }, []);

  return React.createElement(
    ContextTokensContext.Provider,
    { value: { getTokenUsage, setTokenUsage } },
    children
  );
}

export function useContextTokens() {
  const context = useContext(ContextTokensContext);
  if (!context) {
    throw new Error("useContextTokens must be used within a ContextTokensProvider");
  }
  return context;
}
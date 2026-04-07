"use client";

import React, { createContext, useContext, useCallback, useRef } from "react";

type ContextTokensMap = Record<string, number>;
type ContextTokensContextValue = {
  getTokenUsage: (conversationId: string) => number | null;
  setTokenUsage: (conversationId: string, tokens: number) => void;
};

const ContextTokensContext = createContext<ContextTokensContextValue | null>(null);

export function ContextTokensProvider({ children }: { children: React.ReactNode }) {
  const tokensRef = useRef<ContextTokensMap>({});

  const getTokenUsage = useCallback((conversationId: string): number | null => {
    return tokensRef.current[conversationId] ?? null;
  }, []);

  const setTokenUsage = useCallback((conversationId: string, tokens: number) => {
    tokensRef.current[conversationId] = tokens;
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
"use client";

import { useCallback, useEffect, useState } from "react";

import type { ComposerReferences } from "@/lib/reference-tokens";

const EMPTY_REFERENCES: ComposerReferences = { bots: [], skills: [] };

export function useComposerReferences(conversationId: string | null) {
  const [references, setReferences] = useState<ComposerReferences>(EMPTY_REFERENCES);

  const refresh = useCallback(async () => {
    const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
    try {
      const response = await fetch(`/api/composer/references${query}`);
      if (!response.ok) return;
      const payload = (await response.json()) as Partial<ComposerReferences>;
      setReferences({
        bots: Array.isArray(payload.bots) ? payload.bots : [],
        skills: Array.isArray(payload.skills) ? payload.skills : []
      });
    } catch {
      return;
    }
  }, [conversationId]);

  useEffect(() => {
    setReferences(EMPTY_REFERENCES);
    void refresh();
  }, [refresh]);

  return { references, refresh };
}

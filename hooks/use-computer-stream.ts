"use client";

import { useEffect, useRef, useState } from "react";

import type { ComputerState } from "@/lib/types";

export type ComputerView = Omit<ComputerState, "type"> & { frameUrl: string | null };

const INITIAL_VIEW: ComputerView = { live: false, url: null, caption: null, viewport: null, frameUrl: null };
const MAX_RETRY_MS = 10_000;
const FRAME_REVOKE_DELAY_MS = 2_000;

export function useComputerStream(conversationId: string | undefined) {
  const [view, setView] = useState<ComputerView>(INITIAL_VIEW);
  const frameUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setView((previous) => (previous.live ? { ...previous, live: false, caption: null } : previous));
      return;
    }

    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/ws/computer?conversationId=${encodeURIComponent(conversationId)}`
      );
      socket.binaryType = "blob";
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event: MessageEvent<string | Blob>) => {
        if (typeof event.data === "string") {
          try {
            const state = JSON.parse(event.data) as ComputerState;
            if (state.type !== "computer_state") return;
            setView((previous) => ({
              ...previous,
              live: state.live,
              url: state.url ?? previous.url,
              caption: state.caption,
              viewport: state.viewport ?? previous.viewport
            }));
          } catch {
            return;
          }
          return;
        }
        const next = URL.createObjectURL(event.data);
        const previous = frameUrlRef.current;
        frameUrlRef.current = next;
        setView((current) => ({ ...current, frameUrl: next }));
        if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), FRAME_REVOKE_DELAY_MS);
      };
      socket.onclose = () => {
        if (closed) return;
        setView((previous) => ({ ...previous, live: false }));
        retryTimer = window.setTimeout(connect, Math.min(MAX_RETRY_MS, 500 * 2 ** attempt));
        attempt += 1;
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [conversationId]);

  useEffect(
    () => () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    },
    []
  );

  return view;
}

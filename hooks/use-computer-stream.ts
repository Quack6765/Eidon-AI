"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ComputerState } from "@/lib/types";

export type ComputerView = Omit<ComputerState, "type"> & { frameUrl: string | null };

export type ComputerInput =
  | { type: "computer_pointer"; action: "down" | "up" | "move"; x: number; y: number; button?: "left" | "right" | "middle"; clickCount?: number }
  | { type: "computer_wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "computer_key"; action: "down" | "up"; key: string; modifiers?: number }
  | { type: "computer_text"; text: string };

const INITIAL_VIEW: ComputerView = {
  live: false,
  controlOwner: "bot",
  url: null,
  caption: null,
  viewport: null,
  frameUrl: null
};
const MAX_RETRY_MS = 10_000;
const FRAME_REVOKE_DELAY_MS = 2_000;

export function displayComputerUrl(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export async function requestComputerControl(conversationId: string, action: "take" | "return", note?: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/computer/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(note ? { note } : {}) })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || (action === "take" ? "Could not take control" : "Could not return control"));
  }
}

export function useComputerStream(conversationId: string | undefined) {
  const [view, setView] = useState<ComputerView>(INITIAL_VIEW);
  const frameUrlRef = useRef<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setView((previous) =>
        previous.live || previous.controlOwner === "user"
          ? { ...previous, live: false, caption: null, controlOwner: "bot" }
          : previous
      );
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
      socketRef.current = socket;
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
              controlOwner: state.controlOwner === "user" ? "user" : "bot",
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
      socketRef.current = null;
    };
  }, [conversationId]);

  const send = useCallback((input: ComputerInput) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(input));
  }, []);

  useEffect(
    () => () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    },
    []
  );

  return { view, send };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "@/lib/ws-protocol";
import { serializeClientMessage, type ClientMessage } from "@/lib/ws-protocol";

type UseWebSocketOptions = {
  onMessage?: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

type UseWebSocketReturn = {
  send: (msg: ClientMessage) => void;
  subscribe: (conversationId: string) => void;
  unsubscribe: (conversationId: string) => void;
  connected: boolean;
};

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const currentSubscriptionRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const MAX_RECONNECT_DELAY = 30000;

  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      optionsRef.current.onOpen?.();
      if (currentSubscriptionRef.current) {
        ws.send(serializeClientMessage({ type: "subscribe", conversationId: currentSubscriptionRef.current }));
      }
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data.toString()) as ServerMessage;
        optionsRef.current.onMessage?.(msg);
      } catch { /* ignore malformed messages */ }
    });

    ws.addEventListener("close", () => {
      setConnected(false);
      wsRef.current = null;
      optionsRef.current.onClose?.();
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), MAX_RECONNECT_DELAY);
    reconnectAttemptsRef.current++;
    reconnectTimeoutRef.current = setTimeout(connect, delay);
  }

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(serializeClientMessage(msg));
    }
  }, []);

  const subscribe = useCallback((conversationId: string) => {
    currentSubscriptionRef.current = conversationId;
    send({ type: "subscribe", conversationId });
  }, [send]);

  const unsubscribe = useCallback((conversationId: string) => {
    if (currentSubscriptionRef.current === conversationId) {
      currentSubscriptionRef.current = null;
    }
    send({ type: "unsubscribe", conversationId });
  }, [send]);

  return { send, subscribe, unsubscribe, connected };
}

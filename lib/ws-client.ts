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
  failed: boolean;
};

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const currentSubscriptionRef = useRef<string | null>(null);
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const optionsRef = useRef(options);
  const hasOpenedRef = useRef(false);
  optionsRef.current = options;

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempts = 0;
    let disposed = false;

    const MAX_RECONNECT_DELAY = 30000;

    function scheduleReconnect() {
      if (disposed) {
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
      reconnectAttempts++;
      reconnectTimeout = setTimeout(connect, delay);
    }

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setConnected(true);
        setFailed(false);
        hasOpenedRef.current = true;
        reconnectAttempts = 0;
        optionsRef.current.onOpen?.();
        if (currentSubscriptionRef.current) {
          ws.send(serializeClientMessage({ type: "subscribe", conversationId: currentSubscriptionRef.current }));
        }
        while (pendingMessagesRef.current.length > 0) {
          const message = pendingMessagesRef.current.shift();
          if (!message) {
            continue;
          }
          ws.send(serializeClientMessage(message));
        }
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data.toString()) as ServerMessage;
          optionsRef.current.onMessage?.(msg);
        } catch { /* ignore malformed messages */ }
      });

      ws.addEventListener("close", () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        if (disposed) {
          return;
        }

        setConnected(false);
        if (!hasOpenedRef.current) {
          setFailed(true);
        }
        optionsRef.current.onClose?.();
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(serializeClientMessage(msg));
      return;
    }

    pendingMessagesRef.current.push(msg);
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

  return { send, subscribe, unsubscribe, connected, failed };
}

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

const globalListeners = new Set<(msg: ServerMessage) => void>();
let singletonWs: WebSocket | null = null;
let singletonRefCount = 0;
let singletonReconnectTimeout: ReturnType<typeof setTimeout> | undefined;
let singletonReconnectAttempts = 0;
let singletonHasOpened = false;
const pendingMessages: ClientMessage[] = [];
let currentSubscription: string | null = null;
let singletonOnOpenCbs = new Set<() => void>();
let singletonOnCloseCbs = new Set<() => void>();

function singletonConnect() {
  if (typeof window === "undefined") return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  singletonWs = ws;

  ws.addEventListener("open", () => {
    singletonHasOpened = true;
    singletonReconnectAttempts = 0;
    for (const cb of singletonOnOpenCbs) cb();

    if (currentSubscription) {
      ws.send(serializeClientMessage({ type: "subscribe", conversationId: currentSubscription }));
    }
    while (pendingMessages.length > 0) {
      const message = pendingMessages.shift();
      if (!message) continue;
      ws.send(serializeClientMessage(message));
    }
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data.toString()) as ServerMessage;
      for (const listener of globalListeners) {
        listener(msg);
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.addEventListener("close", () => {
    if (singletonWs === ws) singletonWs = null;
    for (const cb of singletonOnCloseCbs) cb();
    scheduleSingletonReconnect();
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

function scheduleSingletonReconnect() {
  if (singletonReconnectTimeout) clearTimeout(singletonReconnectTimeout);
  const delay = Math.min(1000 * Math.pow(2, singletonReconnectAttempts), 30000);
  singletonReconnectAttempts++;
  singletonReconnectTimeout = setTimeout(singletonConnect, delay);
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    singletonRefCount++;

    if (!singletonWs || singletonWs.readyState === WebSocket.CLOSED || singletonWs.readyState === WebSocket.CLOSING) {
      if (!singletonWs || singletonWs.readyState === WebSocket.CLOSED) {
        singletonConnect();
      }
    }

    function handleOpen() {
      setConnected(true);
      setFailed(false);
    }
    function handleClose() {
      setConnected(false);
      if (!singletonHasOpened) setFailed(true);
    }

    singletonOnOpenCbs.add(handleOpen);
    singletonOnCloseCbs.add(handleClose);

    if (singletonWs?.readyState === WebSocket.OPEN) {
      setConnected(true);
      setFailed(false);
    }

    return () => {
      singletonOnOpenCbs.delete(handleOpen);
      singletonOnCloseCbs.delete(handleClose);
      singletonRefCount--;
      if (singletonRefCount <= 0) {
        singletonRefCount = 0;
        if (singletonReconnectTimeout) clearTimeout(singletonReconnectTimeout);
        singletonWs?.close();
        singletonWs = null;
        singletonHasOpened = false;
        singletonReconnectAttempts = 0;
      }
    };
  }, []);

  useEffect(() => {
    function onMessage(msg: ServerMessage) {
      optionsRef.current.onMessage?.(msg);
    }
    globalListeners.add(onMessage);
    return () => { globalListeners.delete(onMessage); };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (singletonWs?.readyState === WebSocket.OPEN) {
      singletonWs.send(serializeClientMessage(msg));
      return;
    }
    pendingMessages.push(msg);
  }, []);

  const subscribe = useCallback((conversationId: string) => {
    currentSubscription = conversationId;
    send({ type: "subscribe", conversationId });
  }, [send]);

  const unsubscribe = useCallback((conversationId: string) => {
    if (currentSubscription === conversationId) currentSubscription = null;
    send({ type: "unsubscribe", conversationId });
  }, [send]);

  return { send, subscribe, unsubscribe, connected, failed };
}

export function addGlobalWsListener(listener: (msg: ServerMessage) => void) {
  globalListeners.add(listener);
  return () => { globalListeners.delete(listener); };
}

export function useGlobalWebSocket(): { connected: boolean } {
  const { connected } = useWebSocket();
  return { connected };
}
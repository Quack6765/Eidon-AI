import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { WebSocketServer } from "ws";

type UpgradeFallback = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
) => void;

export function resolveWebSocketAuthMode(request: IncomingMessage) {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  return pathname === "/api/v1/ws" ? "mobile" as const : "browser" as const;
}

export function routeWebSocketUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  servers: Record<string, WebSocketServer>,
  fallback: UpgradeFallback
) {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const target = servers[pathname];
  if (!target) {
    fallback(request, socket, head);
    return;
  }

  target.handleUpgrade(request, socket, head, (websocket) => {
    target.emit("connection", websocket, request);
  });
}

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";

import {
  resolveWebSocketAuthMode,
  routeWebSocketUpgrade
} from "@/lib/ws-upgrade-router";

function request(url: string) {
  return { url } as IncomingMessage;
}

function target() {
  const websocket = {};
  const server = {
    handleUpgrade: vi.fn((
      incoming: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      complete: (client: WebSocket, request: IncomingMessage) => void
    ) => {
      void socket;
      void head;
      complete(websocket as WebSocket, incoming);
    }),
    emit: vi.fn()
  } as unknown as WebSocketServer;
  return { server, websocket };
}

describe("WebSocket upgrade routing", () => {
  it.each([
    ["/ws?client=browser", "browser"],
    ["/api/v1/ws?client=native", "mobile"],
    ["/_next/webpack-hmr", "browser"]
  ])("resolves %s as %s authentication", (url, expectedMode) => {
    expect(resolveWebSocketAuthMode(request(url))).toBe(expectedMode);
  });

  it.each([
    ["/ws?client=browser", "/ws"],
    ["/api/v1/ws?client=native", "/api/v1/ws"]
  ])("routes %s to only %s", (url, expectedPath) => {
    const browser = target();
    const mobile = target();
    const fallback = vi.fn();
    const incoming = request(url);
    const socket = {} as Duplex;
    const head = Buffer.alloc(0);

    routeWebSocketUpgrade(
      incoming,
      socket,
      head,
      { "/ws": browser.server, "/api/v1/ws": mobile.server },
      fallback
    );

    const selected = expectedPath === "/ws" ? browser : mobile;
    const skipped = expectedPath === "/ws" ? mobile : browser;
    expect(selected.server.handleUpgrade).toHaveBeenCalledOnce();
    expect(selected.server.emit).toHaveBeenCalledWith(
      "connection",
      selected.websocket,
      incoming
    );
    expect(skipped.server.handleUpgrade).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("delegates unrelated upgrades to Next.js", () => {
    const browser = target();
    const mobile = target();
    const fallback = vi.fn();
    const incoming = request("/_next/webpack-hmr");
    const socket = {} as Duplex;
    const head = Buffer.alloc(0);

    routeWebSocketUpgrade(
      incoming,
      socket,
      head,
      { "/ws": browser.server, "/api/v1/ws": mobile.server },
      fallback
    );

    expect(fallback).toHaveBeenCalledWith(incoming, socket, head);
    expect(browser.server.handleUpgrade).not.toHaveBeenCalled();
    expect(mobile.server.handleUpgrade).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addGlobalWsListener, useWebSocket } from "@/lib/ws-client";

type Listener = () => void;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send() {}

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    for (const listener of this.listeners.get("close") ?? []) listener();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    for (const listener of this.listeners.get("open") ?? []) listener();
  }
}

describe("ws-client reconnect listeners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tells listeners when the socket comes back after a drop, but not on the first connect", () => {
    const onReconnect = vi.fn();
    const hook = renderHook(() => useWebSocket());
    const removeListener = addGlobalWsListener(() => {}, { onReconnect });

    act(() => FakeWebSocket.instances[0]!.open());
    expect(onReconnect).not.toHaveBeenCalled();

    act(() => FakeWebSocket.instances[0]!.close());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    act(() => FakeWebSocket.instances[1]!.open());
    expect(onReconnect).toHaveBeenCalledTimes(1);

    removeListener();
    act(() => FakeWebSocket.instances[1]!.close());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => FakeWebSocket.instances[2]!.open());
    expect(onReconnect).toHaveBeenCalledTimes(1);

    hook.unmount();
  });
});

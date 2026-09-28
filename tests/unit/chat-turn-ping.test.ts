// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isChatPingEnabled,
  maybeNotifyTurnReady,
  setChatPingEnabled,
  shouldNotifyTurnReady
} from "@/lib/chat-turn-ping";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: hidden ? "hidden" : "visible"
  });
}

function stubPermission(permission: NotificationPermission | "none") {
  if (permission === "none") {
    vi.stubGlobal("Notification", undefined);
    return;
  }
  vi.stubGlobal("Notification", { permission });
}

function stubServiceWorker(showNotification: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ showNotification }) }
  });
}

function clearServiceWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: undefined
  });
}

let showNotification: ReturnType<typeof vi.fn>;

beforeEach(() => {
  showNotification = vi.fn().mockResolvedValue(undefined);
  localStorage.clear();
  setHidden(true);
  stubPermission("granted");
  stubServiceWorker(showNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shouldNotifyTurnReady", () => {
  it("requires hidden tab, granted permission, and enabled preference", () => {
    expect(
      shouldNotifyTurnReady({ visibilityState: "hidden", permission: "granted", enabled: true })
    ).toBe(true);
    expect(
      shouldNotifyTurnReady({ visibilityState: "visible", permission: "granted", enabled: true })
    ).toBe(false);
    expect(
      shouldNotifyTurnReady({ visibilityState: "hidden", permission: "denied", enabled: true })
    ).toBe(false);
    expect(
      shouldNotifyTurnReady({ visibilityState: "hidden", permission: "default", enabled: true })
    ).toBe(false);
    expect(
      shouldNotifyTurnReady({ visibilityState: "hidden", permission: "granted", enabled: false })
    ).toBe(false);
  });
});

describe("chat ping preference", () => {
  it("defaults to enabled", () => {
    expect(isChatPingEnabled(null)).toBe(true);
    expect(isChatPingEnabled(localStorage)).toBe(true);
  });

  it("persists an opt-out", () => {
    setChatPingEnabled(localStorage, false);
    expect(isChatPingEnabled(localStorage)).toBe(false);
    setChatPingEnabled(localStorage, true);
    expect(isChatPingEnabled(localStorage)).toBe(true);
  });

  it("treats broken storage as enabled", () => {
    expect(
      isChatPingEnabled({
        getItem: () => {
          throw new Error("blocked");
        }
      })
    ).toBe(true);
  });
});

describe("maybeNotifyTurnReady", () => {
  it("shows a local notification when the tab is hidden", async () => {
    await maybeNotifyTurnReady();
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      "Eidon",
      expect.objectContaining({ body: "Reply ready" })
    );
  });

  it("never fires while the tab is visible", async () => {
    setHidden(false);
    await maybeNotifyTurnReady();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("never fires without granted permission", async () => {
    stubPermission("denied");
    await maybeNotifyTurnReady();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("never fires when the user opted out", async () => {
    setChatPingEnabled(localStorage, false);
    await maybeNotifyTurnReady();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("falls back to the Notification constructor without a service worker", async () => {
    clearServiceWorker();
    const constructor = vi.fn();
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("Notification", Object.assign(constructor, { permission: "granted" }));

    await maybeNotifyTurnReady();
    expect(constructor).toHaveBeenCalledWith("Eidon", { body: "Reply ready" });
  });

  it("does nothing when notifications are unavailable", async () => {
    clearServiceWorker();
    stubPermission("none");
    await expect(maybeNotifyTurnReady()).resolves.toBeUndefined();
  });

  it("swallows service worker failures", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        get ready() {
          return Promise.reject(new Error("no registration"));
        }
      }
    });
    await expect(maybeNotifyTurnReady()).resolves.toBeUndefined();
  });
});

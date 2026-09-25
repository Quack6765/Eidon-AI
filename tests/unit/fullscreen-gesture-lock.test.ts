// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { installFullscreenGestureLock } from "@/lib/fullscreen-gesture-lock";

describe("installFullscreenGestureLock", () => {
  let overlay: HTMLDivElement;
  let outside: HTMLDivElement;

  function dispatchGesture(type: string, target: Element) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  beforeAll(() => {
    installFullscreenGestureLock();
    installFullscreenGestureLock();
  });

  beforeEach(() => {
    overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-50";
    document.body.appendChild(overlay);
    outside = document.createElement("div");
    document.body.appendChild(outside);
  });

  afterEach(() => {
    overlay.remove();
    outside.remove();
  });

  it("blocks pinch gestures that start inside the fullscreen overlay", () => {
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      const event = dispatchGesture(type, overlay);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("blocks gestures on elements nested inside the overlay", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.appendChild(svg);
    const event = dispatchGesture("gesturestart", svg);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves gestures outside the overlay alone", () => {
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      const event = dispatchGesture(type, outside);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("blocks pinch gestures that start on an inline mermaid card", () => {
    const card = document.createElement("div");
    card.setAttribute("data-streamdown", "mermaid-block");
    document.body.appendChild(card);
    const event = dispatchGesture("gesturestart", card);
    expect(event.defaultPrevented).toBe(true);
    card.remove();
  });
});

// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IOS_PWA_CONVERSATION_VIEWPORT_EVENT } from "@/lib/use-ios-pwa";

const stickContextMock = vi.hoisted(() => ({
  contentRef: { current: null as HTMLElement | null },
  scrollRef: { current: null as HTMLElement | null }
}));

vi.mock("use-stick-to-bottom", () => ({
  StickToBottom: Object.assign(
    ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
    { Content: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children) }
  ),
  useStickToBottomContext: () => stickContextMock
}));

import { ConversationScrollbar } from "@/components/ai-elements/conversation";

describe("ConversationScrollbar", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let resizeObserverCallbacks: ResizeObserverCallback[] = [];
  let scrollMetrics = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
  let trackMetrics = { clientHeight: 256 };

  beforeEach(() => {
    resizeObserverCallbacks = [];
    scrollMetrics = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
    trackMetrics = { clientHeight: 256 };
    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      writable: true,
      value: class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;

        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
          this.pointerType = init.pointerType ?? "";
        }
      }
    });
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      scrollTop: {
        configurable: true,
        get: () => scrollMetrics.scrollTop,
        set: (value: number) => {
          scrollMetrics.scrollTop = Math.max(
            0,
            Math.min(value, scrollMetrics.scrollHeight - scrollMetrics.clientHeight)
          );
        }
      },
      scrollHeight: { configurable: true, get: () => scrollMetrics.scrollHeight },
      clientHeight: { configurable: true, get: () => scrollMetrics.clientHeight }
    });
    stickContextMock.scrollRef.current = scroller;
    stickContextMock.contentRef.current = document.createElement("div");
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { PointerEvent?: unknown }).PointerEvent;
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function renderScrollbar() {
    const view = render(<ConversationScrollbar />);
    const track = view.container.querySelector("div.absolute.right-0") as HTMLElement;
    Object.defineProperty(track, "clientHeight", {
      configurable: true,
      get: () => trackMetrics.clientHeight
    });
    const thumb = view.container.querySelector(
      '[class*="bg-[var(--accent)]"]'
    ) as HTMLElement;
    return { track, thumb };
  }

  function stubPointerCapture(element: HTMLElement) {
    Object.assign(element, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn()
    });
  }

  function stubTrackRect(track: HTMLElement, height = 256) {
    track.getBoundingClientRect = vi.fn(
      () =>
        ({
          bottom: height,
          height,
          left: 0,
          right: 16,
          toJSON: () => ({}),
          top: 0,
          width: 16,
          x: 0,
          y: 0
        }) as DOMRect
    );
  }

  it("stays inert when the content fits the viewport", () => {
    const { track, thumb } = renderScrollbar();

    expect(track).not.toBeNull();
    expect(thumb).not.toBeNull();
    expect(track.className).toContain("opacity-0");
    expect(track.className).toContain("pointer-events-none");
    expect(track.className).toContain("touch-none");
    expect(track.className).toContain("pointer-coarse:w-11");
    expect(track.className).not.toContain("pointer-coarse:fixed");
    expect(track.className).not.toContain(["pointer-coarse", "pointer-events-auto"].join(":"));
    expect(track.className).toContain("-webkit-touch-callout:none");
    expect(track.className).toContain("select-none");
    expect(track.className).toContain("-webkit-user-select:none");

    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);

    expect(track.className).toContain("opacity-0");
    expect(track.className).toContain("pointer-events-none");
  });

  it("reflects scroll position in the thumb geometry", () => {
    scrollMetrics = { scrollTop: 192, scrollHeight: 512, clientHeight: 128 };
    const { track, thumb } = renderScrollbar();

    expect(thumb.style.height).toBe("0px");
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);

    expect(thumb.style.height).toBe("64px");
    expect(thumb.style.top).toBe("96px");
    expect(track.className).toContain("opacity-100");

    scrollMetrics.scrollHeight = 2048;
    scrollMetrics.scrollTop = 960;
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);

    expect(thumb.style.height).toBe("28px");
    expect(thumb.style.top).toBe("114px");
  });

  it("reveals on scroll, auto-hides after idle, and stays visible while dragging", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { track, thumb } = renderScrollbar();

    expect(track.className).toContain("opacity-0");

    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    expect(track.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(track.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(track.className).toContain("opacity-0");

    stubPointerCapture(thumb);
    fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 0 });
    expect(track.className).toContain("opacity-100");
    expect(track.className).toContain("select-none");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(track.className).toContain("opacity-100");

    fireEvent.pointerUp(thumb, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(track.className).toContain("opacity-0");
  });

  it("drags the thumb and scrolls the conversation proportionally", () => {
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { thumb } = renderScrollbar();
    stubPointerCapture(thumb);

    fireEvent.pointerDown(thumb, { pointerId: 7, clientY: 0 });
    expect(scrollMetrics.scrollTop).toBe(0);
    expect(thumb.setPointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerMove(thumb, { pointerId: 7, clientY: 100 });
    expect(scrollMetrics.scrollTop).toBe(500);

    fireEvent.pointerMove(thumb, { pointerId: 7, clientY: 25 });
    expect(scrollMetrics.scrollTop).toBe(150);

    fireEvent.pointerUp(thumb, { pointerId: 7 });
    expect(thumb.releasePointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerMove(thumb, { pointerId: 7, clientY: 100 });
    expect(scrollMetrics.scrollTop).toBe(150);
  });

  it("centers the viewport on the clicked track position", () => {
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { track } = renderScrollbar();
    track.getBoundingClientRect = vi.fn(
      () =>
        ({
          bottom: 240,
          height: 240,
          left: 0,
          right: 16,
          toJSON: () => ({}),
          top: 0,
          width: 16,
          x: 0,
          y: 0
        }) as DOMRect
    );

    fireEvent.pointerDown(track, { pointerId: 3, clientY: 120 });
    expect(scrollMetrics.scrollTop).toBe(200);

    fireEvent.pointerDown(track, { pointerId: 4, clientY: 240 });
    expect(scrollMetrics.scrollTop).toBe(450);

    fireEvent.pointerDown(track, { pointerId: 5, clientY: 0 });
    expect(scrollMetrics.scrollTop).toBe(0);
  });

  it("jumps to the released touch position on a quick tap", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 512, clientHeight: 128 };
    const { track, thumb } = renderScrollbar();
    stubTrackRect(track, 240);
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);

    fireEvent.pointerDown(track, { pointerId: 11, pointerType: "touch", clientY: 120 });
    expect(scrollMetrics.scrollTop).toBe(0);
    expect(track.className).not.toContain("w-7");

    fireEvent.pointerUp(track, { pointerId: 11, pointerType: "touch", clientY: 120 });
    expect(scrollMetrics.scrollTop).toBe(128);
    expect(track.className).not.toContain("w-7");
    expect(thumb.className).not.toContain("w-3");
  });

  it("enters scrub mode after a 150ms hold and snaps the thumb under the finger", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 512, clientHeight: 128 };
    const { track, thumb } = renderScrollbar();
    stubTrackRect(track);
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    stubPointerCapture(track);

    fireEvent.pointerDown(track, { pointerId: 12, pointerType: "touch", clientY: 128 });
    expect(track.className).not.toContain("w-7");

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(track.className).toContain("w-7");
    expect(track.className).toContain("pointer-coarse:w-11");
    expect(track.className).toContain("select-none");
    expect(thumb.className).toContain("w-3");
    expect(track.setPointerCapture).toHaveBeenCalledWith(12);
    expect(scrollMetrics.scrollTop).toBe(192);
  });

  it("scrubs absolutely while held, the thumb center tracking the finger", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 512, clientHeight: 128 };
    const { track } = renderScrollbar();
    stubTrackRect(track);
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    stubPointerCapture(track);

    fireEvent.pointerDown(track, { pointerId: 13, pointerType: "touch", clientY: 128 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(scrollMetrics.scrollTop).toBe(192);

    fireEvent.pointerMove(track, { pointerId: 13, pointerType: "touch", clientY: 160 });
    expect(scrollMetrics.scrollTop).toBe(256);

    fireEvent.pointerMove(track, { pointerId: 13, pointerType: "touch", clientY: 224 });
    expect(scrollMetrics.scrollTop).toBe(384);

    fireEvent.pointerMove(track, { pointerId: 13, pointerType: "touch", clientY: 32 });
    expect(scrollMetrics.scrollTop).toBe(0);

    fireEvent.pointerMove(track, { pointerId: 13, pointerType: "touch", clientY: 400 });
    expect(scrollMetrics.scrollTop).toBe(384);
  });

  it("exits scrub mode on release and re-hides after idle", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 512, clientHeight: 128 };
    const { track, thumb } = renderScrollbar();
    stubTrackRect(track);
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    stubPointerCapture(track);

    fireEvent.pointerDown(track, { pointerId: 14, pointerType: "touch", clientY: 128 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(track.className).toContain("w-7");

    fireEvent.pointerUp(track, { pointerId: 14, pointerType: "touch", clientY: 128 });
    expect(track.releasePointerCapture).toHaveBeenCalledWith(14);
    expect(track.className).not.toContain("w-7");
    expect(thumb.className).not.toContain("w-3");

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(track.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(track.className).toContain("opacity-0");
  });

  it("enters scrub mode when the finger drags past the slop radius before the hold delay", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 512, clientHeight: 128 };
    const { track, thumb } = renderScrollbar();
    stubTrackRect(track);
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    stubPointerCapture(track);

    fireEvent.pointerDown(track, { pointerId: 15, pointerType: "touch", clientY: 128 });
    expect(track.className).not.toContain("w-7");

    fireEvent.pointerMove(track, { pointerId: 15, pointerType: "touch", clientY: 139 });

    expect(track.setPointerCapture).toHaveBeenCalledWith(15);
    expect(track.className).toContain("w-7");
    expect(thumb.className).toContain("w-3");
    expect(scrollMetrics.scrollTop).toBe(214);

    fireEvent.pointerMove(track, { pointerId: 15, pointerType: "touch", clientY: 171 });
    expect(scrollMetrics.scrollTop).toBe(278);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(track.className).toContain("w-7");

    fireEvent.pointerUp(track, { pointerId: 15, pointerType: "touch", clientY: 171 });
    expect(track.releasePointerCapture).toHaveBeenCalledWith(15);
    expect(track.className).not.toContain("w-7");
    expect(scrollMetrics.scrollTop).toBe(278);
  });

  it("keeps the strip always visible and touchable on coarse pointers while hiding it on fine pointers", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { track } = renderScrollbar();

    expect(track.className).toContain("pointer-fine:opacity-0");
    expect(track.className).not.toContain("pointer-fine:pointer-events-none");
    expect(track.className.split(" ")).not.toContain("pointer-events-none");

    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    expect(track.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(track.className).toContain("pointer-fine:opacity-0");
    expect(track.className.split(" ")).not.toContain("pointer-events-none");
  });

  it("reveals on mouse hover, stays visible while hovered, and hides after leaving", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { track } = renderScrollbar();

    expect(track.className).toContain("pointer-fine:opacity-0");

    fireEvent.pointerOver(track, { pointerType: "mouse" });
    expect(track.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(track.className).toContain("opacity-100");

    fireEvent.pointerOut(track, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(track.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(track.className).toContain("pointer-fine:opacity-0");
  });

  it("does not pin visibility from touch pointer enter events", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { track } = renderScrollbar();

    fireEvent.pointerOver(track, { pointerType: "touch" });
    expect(track.className).toContain("pointer-fine:opacity-0");

    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    expect(track.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(track.className).toContain("pointer-fine:opacity-0");
  });

  it("jumps on a quick tap even when the fade state is idle", () => {
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { track } = renderScrollbar();
    stubTrackRect(track, 240);

    expect(track.className).toContain("pointer-fine:opacity-0");

    fireEvent.pointerDown(track, { pointerId: 31, pointerType: "touch", clientY: 120 });
    expect(track.className).toContain("opacity-100");

    fireEvent.pointerUp(track, { pointerId: 31, pointerType: "touch", clientY: 120 });
    expect(scrollMetrics.scrollTop).toBe(200);

    fireEvent.pointerDown(track, { pointerId: 32, pointerType: "touch", clientY: 240 });
    fireEvent.pointerUp(track, { pointerId: 32, pointerType: "touch", clientY: 240 });
    expect(scrollMetrics.scrollTop).toBe(450);
  });

  it("exits scrub mode from window-captured pointer events when the track misses them", () => {
    vi.useFakeTimers();
    scrollMetrics = { scrollTop: 0, scrollHeight: 512, clientHeight: 128 };
    const { track } = renderScrollbar();
    stubTrackRect(track);
    fireEvent.scroll(stickContextMock.scrollRef.current as HTMLElement);
    stubPointerCapture(track);

    fireEvent.pointerDown(track, { pointerId: 21, pointerType: "touch", clientY: 128 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(track.className).toContain("w-7");

    act(() => {
      fireEvent.pointerMove(window, { pointerId: 21, pointerType: "touch", clientY: 224 });
    });
    expect(scrollMetrics.scrollTop).toBe(384);

    act(() => {
      fireEvent.pointerMove(window, { pointerId: 99, pointerType: "touch", clientY: 32 });
    });
    expect(scrollMetrics.scrollTop).toBe(384);

    act(() => {
      fireEvent.pointerUp(window, { pointerId: 21, pointerType: "touch" });
    });
    expect(track.className).not.toContain("w-7");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(track.className).toContain("opacity-0");
  });

  it("cancels native touch defaults on the strip", () => {
    const { track } = renderScrollbar();

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    track.dispatchEvent(startEvent);
    expect(startEvent.defaultPrevented).toBe(true);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    track.dispatchEvent(moveEvent);
    expect(moveEvent.defaultPrevented).toBe(true);
  });

  it("re-measures geometry on resize observer, window resize, and iOS viewport events", () => {
    const { thumb } = renderScrollbar();
    expect(thumb.style.height).toBe("0px");

    scrollMetrics = { scrollTop: 192, scrollHeight: 512, clientHeight: 128 };
    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });
    expect(thumb.style.height).toBe("64px");
    expect(thumb.style.top).toBe("96px");

    scrollMetrics.scrollTop = 384;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(thumb.style.top).toBe("192px");

    scrollMetrics.scrollTop = 192;
    act(() => {
      window.dispatchEvent(new Event(IOS_PWA_CONVERSATION_VIEWPORT_EVENT));
    });
    expect(thumb.style.top).toBe("96px");
  });

  it("forwards wheel deltas over the strip to the scroller", () => {
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
    const { track } = renderScrollbar();

    fireEvent.wheel(track, { deltaY: 120 });
    expect(scrollMetrics.scrollTop).toBe(120);

    fireEvent.wheel(track, { deltaY: -45 });
    expect(scrollMetrics.scrollTop).toBe(75);
  });
});

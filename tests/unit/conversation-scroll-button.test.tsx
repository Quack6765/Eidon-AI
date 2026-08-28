// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IOS_PWA_CONVERSATION_VIEWPORT_EVENT } from "@/lib/use-ios-pwa";

const stickContextMock = vi.hoisted(() => ({
  contentRef: { current: null as HTMLElement | null },
  scrollRef: { current: null as HTMLElement | null },
  scrollToBottom: vi.fn(),
  state: { targetScrollTop: 480 },
  stopScroll: vi.fn(),
  targetScrollTop: null as (() => number) | null
}));

vi.mock("use-stick-to-bottom", () => ({
  StickToBottom: Object.assign(
    ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
    { Content: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children) }
  ),
  useStickToBottomContext: () => stickContextMock
}));

import { ConversationScrollButton } from "@/components/ai-elements/conversation";

describe("ConversationScrollButton", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let resizeObserverCallbacks: ResizeObserverCallback[] = [];
  let scrollMetrics = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };

  beforeEach(() => {
    resizeObserverCallbacks = [];
    scrollMetrics = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      scrollTop: {
        configurable: true,
        get: () => scrollMetrics.scrollTop,
        set: (value: number) => { scrollMetrics.scrollTop = value; }
      },
      scrollHeight: { configurable: true, get: () => scrollMetrics.scrollHeight },
      clientHeight: { configurable: true, get: () => scrollMetrics.clientHeight }
    });
    stickContextMock.scrollRef.current = scroller;
    stickContextMock.contentRef.current = document.createElement("div");
    stickContextMock.scrollToBottom.mockReset();
    stickContextMock.stopScroll.mockReset();
    stickContextMock.targetScrollTop = null;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function placeContentBelowViewport() {
    scrollMetrics = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
  }

  it("renders nothing when there is no content below the viewport", () => {
    render(React.createElement(ConversationScrollButton));
    expect(screen.queryByRole("button", { name: "Scroll to latest messages" })).toBeNull();
  });

  it("scrolls decisively on click, overriding in-flight user scrolling", async () => {
    placeContentBelowViewport();
    stickContextMock.scrollToBottom.mockResolvedValue(true);
    render(React.createElement(ConversationScrollButton));

    fireEvent.click(screen.getByRole("button", { name: "Scroll to latest messages" }));

    expect(stickContextMock.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(stickContextMock.scrollToBottom).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreEscapes: true,
        animation: expect.objectContaining({ stiffness: expect.any(Number) })
      })
    );

    await waitFor(() => {
      expect(stickContextMock.stopScroll).toHaveBeenCalledTimes(1);
    });
  });

  it("jumps only to the latest content present at click time and releases auto-follow", async () => {
    let finishScroll = (_value: boolean) => {};
    placeContentBelowViewport();
    stickContextMock.state.targetScrollTop = 480;
    stickContextMock.scrollToBottom.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishScroll = resolve;
      })
    );
    render(React.createElement(ConversationScrollButton));

    fireEvent.click(screen.getByRole("button", { name: "Scroll to latest messages" }));

    expect(stickContextMock.targetScrollTop?.()).toBe(480);
    expect(stickContextMock.stopScroll).not.toHaveBeenCalled();

    finishScroll(true);

    await waitFor(() => {
      expect(stickContextMock.targetScrollTop?.()).toBe(480);
      expect(stickContextMock.stopScroll).toHaveBeenCalledTimes(1);
    });
  });

  it("shows when streamed content grows beyond the fixed viewport", async () => {
    render(React.createElement(ConversationScrollButton));
    expect(screen.queryByRole("button", { name: "Scroll to latest messages" })).toBeNull();

    scrollMetrics.scrollHeight = 140;
    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Scroll to latest messages" })).toBeInTheDocument();
    });
  });

  it("stays hidden when the transcript rests a sub-pixel short of the bottom", async () => {
    scrollMetrics = { scrollTop: 498.5, scrollHeight: 600, clientHeight: 100 };
    render(React.createElement(ConversationScrollButton));

    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Scroll to latest messages" })).toBeNull();
    });
  });

  it("re-evaluates the latest state when the viewport resizes", async () => {
    render(React.createElement(ConversationScrollButton));

    scrollMetrics.clientHeight = 40;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Scroll to latest messages" })).toBeInTheDocument();
    });
  });

  it("hides a stale Latest state after the iOS keyboard viewport is compensated", async () => {
    render(React.createElement(ConversationScrollButton));

    scrollMetrics.clientHeight = 50;
    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Scroll to latest messages" })).toBeInTheDocument();
    });

    scrollMetrics.scrollTop = 50;
    act(() => {
      window.dispatchEvent(new Event(IOS_PWA_CONVERSATION_VIEWPORT_EVENT));
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Scroll to latest messages" })).toBeNull();
    });
  });

  it("clears the mobile composer with an icon-only control", () => {
    placeContentBelowViewport();
    render(React.createElement(ConversationScrollButton));

    const button = screen.getByRole("button", { name: "Scroll to latest messages" });
    expect(button.className).toContain("bottom-[var(--composer-height,80px)]");
    expect(screen.getByText("Latest")).toHaveClass("hidden", "md:inline");
  });
});

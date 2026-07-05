// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { useIosPwa } from "@/lib/use-ios-pwa";

function setNavigatorStandalone(value: boolean | undefined) {
  if (value === undefined) {
    delete (navigator as { standalone?: boolean }).standalone;
    return;
  }
  Object.defineProperty(navigator, "standalone", { configurable: true, value });
}

function hasIosPwaClass() {
  return document.documentElement.classList.contains("ios-pwa");
}

function setInnerHeight(value: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value,
  });
}

function appHeightVar() {
  return document.documentElement.style.getPropertyValue("--ios-app-height");
}

function setWindowScrollTo(value: typeof window.scrollTo) {
  Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value });
}

function setWindowScroll(x: number, y: number) {
  Object.defineProperty(window, "scrollX", { configurable: true, writable: true, value: x });
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: y });
}

function setElementScroll(element: Element, top: number, left: number) {
  let topValue = top;
  let leftValue = left;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => topValue,
    set: (value: number) => {
      topValue = value;
    },
  });
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    get: () => leftValue,
    set: (value: number) => {
      leftValue = value;
    },
  });
}

describe("useIosPwa", () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let rafCounter: number;
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    rafCallbacks = new Map();
    rafCounter = 0;
    originalRaf = window.requestAnimationFrame;
    originalCaf = window.cancelAnimationFrame;

    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = ++rafCounter;
      rafCallbacks.set(id, cb);
      return id;
    };

    window.cancelAnimationFrame = (id: number) => {
      rafCallbacks.delete(id);
    };
  });

  function flushRaf() {
    const callbacks = Array.from(rafCallbacks.values());
    rafCallbacks.clear();
    callbacks.forEach((cb) => cb(0));
  }

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCaf;
    setNavigatorStandalone(undefined);
    document.documentElement.classList.remove("ios-pwa");
    document.documentElement.style.removeProperty("--ios-app-height");
  });

  let originalScrollTo: typeof window.scrollTo;
  let originalScrollIntoView: Element["scrollIntoView"] | undefined;

  beforeEach(() => {
    originalScrollTo = window.scrollTo;
    originalScrollIntoView = Element.prototype.scrollIntoView;
  });

  afterEach(() => {
    setWindowScrollTo(originalScrollTo);
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
    setWindowScroll(0, 0);
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(document.documentElement, "scrollTop");
    Reflect.deleteProperty(document.documentElement, "scrollLeft");
    vi.useRealTimers();
  });

  it("does not mark the document outside an iOS home-screen app", () => {
    setNavigatorStandalone(false);

    renderHook(() => useIosPwa());

    expect(hasIosPwaClass()).toBe(false);
  });

  it("does not mark the document when navigator.standalone is absent (Android/desktop)", () => {
    setNavigatorStandalone(undefined);

    renderHook(() => useIosPwa());

    expect(hasIosPwaClass()).toBe(false);
  });

  it("adds the ios-pwa class on the document element in an iOS standalone PWA", () => {
    setNavigatorStandalone(true);

    renderHook(() => useIosPwa());

    expect(hasIosPwaClass()).toBe(true);
  });

  it("removes the ios-pwa class on unmount", () => {
    setNavigatorStandalone(true);

    const { unmount } = renderHook(() => useIosPwa());
    expect(hasIosPwaClass()).toBe(true);

    unmount();
    expect(hasIosPwaClass()).toBe(false);
  });

  it("publishes the measured window height as --ios-app-height in an iOS standalone PWA", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    renderHook(() => useIosPwa());

    expect(appHeightVar()).toBe("812px");
  });

  it("updates --ios-app-height on window resize", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    setInnerHeight(640);
    act(() => {
      window.dispatchEvent(new Event("resize"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("640px");
  });

  it("updates --ios-app-height on orientationchange", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    setInnerHeight(375);
    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("375px");
  });

  it("removes --ios-app-height on unmount", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const { unmount } = renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    unmount();
    expect(appHeightVar()).toBe("");
  });

  it("does not set --ios-app-height outside an iOS standalone PWA", () => {
    setNavigatorStandalone(false);
    setInnerHeight(812);

    renderHook(() => useIosPwa());

    expect(appHeightVar()).toBe("");
  });

  it("writes the CSS variable only once when resize fires with unchanged innerHeight", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    act(() => {
      window.dispatchEvent(new Event("resize"));
      flushRaf();
      window.dispatchEvent(new Event("resize"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("812px");

    const spy = vi.spyOn(document.documentElement.style, "setProperty");
    act(() => {
      window.dispatchEvent(new Event("resize"));
      flushRaf();
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("coalesces multiple rapid resize events into a single rAF write", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    setInnerHeight(640);
    act(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    });

    expect(rafCallbacks.size).toBe(1);

    act(() => {
      flushRaf();
    });

    expect(appHeightVar()).toBe("640px");
  });

  it("updates the variable when height changes after the same-height guard", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    setInnerHeight(400);
    act(() => {
      window.dispatchEvent(new Event("resize"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("400px");
  });

  it("cancels a pending rAF frame on unmount", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const { unmount } = renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    setInnerHeight(640);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(rafCallbacks.size).toBe(1);

    unmount();

    expect(rafCallbacks.size).toBe(0);
    expect(appHeightVar()).toBe("");
  });

  it("removes visualViewport resize listener on unmount when visualViewport is present", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const listeners = new Map<string, EventListenerOrEventListenerObject[]>();
    const fakeVisualViewport = {
      height: 812,
      scale: 1,
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        const existing = listeners.get(type) ?? [];
        listeners.set(type, [...existing, listener]);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        const existing = listeners.get(type) ?? [];
        listeners.set(type, existing.filter((l) => l !== listener));
      }),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    const { unmount } = renderHook(() => useIosPwa());

    expect(fakeVisualViewport.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));

    unmount();

    expect(fakeVisualViewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("updates --ios-app-height when visualViewport fires resize without a window resize event", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    let capturedListener: EventListener | null = null;
    const fakeVisualViewport = {
      height: 812,
      scale: 1,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");
    expect(capturedListener).not.toBeNull();

    setInnerHeight(500);
    fakeVisualViewport.height = 500;
    act(() => {
      capturedListener!(new Event("resize"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("500px");

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("follows the visual viewport when the keyboard shrinks it while innerHeight stays fixed", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    let capturedListener: EventListener | null = null;
    const fakeVisualViewport = {
      height: 812,
      offsetTop: 0,
      scale: 1,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");
    expect(capturedListener).not.toBeNull();

    fakeVisualViewport.height = 500;
    act(() => {
      capturedListener!(new Event("resize"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("500px");

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("updates --ios-app-height from window.innerHeight when innerHeight shrinks with the keyboard", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    let capturedListener: EventListener | null = null;
    const fakeVisualViewport = {
      height: 812,
      offsetTop: 0,
      scale: 1,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");

    setInnerHeight(500);
    fakeVisualViewport.height = 500;
    act(() => {
      capturedListener!(new Event("resize"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("500px");

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("ignores the visual viewport while pinch-zoomed so the shell keeps the layout height", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    let capturedListener: EventListener | null = null;
    const fakeVisualViewport = {
      height: 400,
      offsetTop: 0,
      scale: 2,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");
    expect(capturedListener).not.toBeNull();

    act(() => {
      capturedListener!(new Event("resize"));
      flushRaf();
    });

    expect(appHeightVar()).toBe("812px");

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("restores the full shell height when the keyboard closes and the visual viewport grows back", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    let capturedListener: EventListener | null = null;
    const fakeVisualViewport = {
      height: 812,
      offsetTop: 0,
      scale: 1,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    renderHook(() => useIosPwa());
    expect(appHeightVar()).toBe("812px");
    expect(capturedListener).not.toBeNull();

    fakeVisualViewport.height = 500;
    act(() => {
      capturedListener!(new Event("resize"));
      flushRaf();
    });
    expect(appHeightVar()).toBe("500px");

    fakeVisualViewport.height = 812;
    act(() => {
      capturedListener!(new Event("resize"));
      flushRaf();
    });
    expect(appHeightVar()).toBe("812px");

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("does not add listeners and does not set class when not standalone", () => {
    setNavigatorStandalone(false);
    setInnerHeight(812);

    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() => useIosPwa());

    expect(hasIosPwaClass()).toBe(false);
    expect(appHeightVar()).toBe("");
    expect(addSpy).not.toHaveBeenCalledWith("resize", expect.any(Function));
    expect(addSpy).not.toHaveBeenCalledWith("orientationchange", expect.any(Function));

    addSpy.mockRestore();
  });

  it("resets the document pan when the visual viewport resizes while the document is panned", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    let capturedResize: EventListener | null = null;
    const fakeVisualViewport = {
      height: 812,
      scale: 1,
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "resize") {
          capturedResize = listener;
        }
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    const scrollToMock = vi.fn();
    setWindowScrollTo(scrollToMock as unknown as typeof window.scrollTo);

    renderHook(() => useIosPwa());
    expect(capturedResize).not.toBeNull();
    scrollToMock.mockClear();

    setWindowScroll(0, 350);
    const scroller = document.documentElement;
    Object.defineProperty(document, "scrollingElement", { configurable: true, value: scroller });
    setElementScroll(scroller, 120, 15);

    setInnerHeight(500);
    fakeVisualViewport.height = 500;
    act(() => {
      capturedResize!(new Event("resize"));
      flushRaf();
    });

    expect(scrollToMock).toHaveBeenCalledWith(0, 0);
    expect(scroller.scrollTop).toBe(0);
    expect(scroller.scrollLeft).toBe(0);
    expect(appHeightVar()).toBe("500px");

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("corrects the document pan when the visual viewport scrolls without resizing", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    let capturedScroll: EventListener | null = null;
    const fakeVisualViewport = {
      height: 812,
      scale: 1,
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "scroll") {
          capturedScroll = listener;
        }
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    const scrollToMock = vi.fn();
    setWindowScrollTo(scrollToMock as unknown as typeof window.scrollTo);

    renderHook(() => useIosPwa());
    expect(capturedScroll).not.toBeNull();
    scrollToMock.mockClear();

    setWindowScroll(0, 200);
    act(() => {
      capturedScroll!(new Event("scroll"));
      flushRaf();
    });

    expect(scrollToMock).toHaveBeenCalledWith(0, 0);

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("reveals the focused editable element after focusin", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    setWindowScrollTo(vi.fn() as unknown as typeof window.scrollTo);

    const input = document.createElement("input");
    document.body.appendChild(input);

    renderHook(() => useIosPwa());

    act(() => {
      input.focus();
      flushRaf();
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });

    input.remove();
  });

  it("runs a trailing correction after focusin once WebKit's late pan can land", () => {
    vi.useFakeTimers();
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    setWindowScrollTo(vi.fn() as unknown as typeof window.scrollTo);

    const input = document.createElement("input");
    document.body.appendChild(input);

    renderHook(() => useIosPwa());

    act(() => {
      input.focus();
      flushRaf();
    });
    scrollIntoViewMock.mockClear();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });

    input.remove();
  });

  it("clears the trailing focus correction on unmount", () => {
    vi.useFakeTimers();
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    setWindowScrollTo(vi.fn() as unknown as typeof window.scrollTo);

    const input = document.createElement("input");
    document.body.appendChild(input);

    const { unmount } = renderHook(() => useIosPwa());

    act(() => {
      input.focus();
      flushRaf();
    });
    scrollIntoViewMock.mockClear();

    unmount();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    input.remove();
  });

  it("does not scroll a non-editable focused element into view", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    setWindowScrollTo(vi.fn() as unknown as typeof window.scrollTo);

    const button = document.createElement("button");
    document.body.appendChild(button);

    renderHook(() => useIosPwa());

    act(() => {
      button.focus();
      flushRaf();
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    button.remove();
  });

  it("does not listen for focusin and never corrects scroll when not standalone", () => {
    setNavigatorStandalone(false);
    setInnerHeight(812);

    const docAddSpy = vi.spyOn(document, "addEventListener");
    const scrollToMock = vi.fn();
    setWindowScrollTo(scrollToMock as unknown as typeof window.scrollTo);
    setWindowScroll(0, 350);

    renderHook(() => useIosPwa());

    expect(docAddSpy).not.toHaveBeenCalledWith("focusin", expect.any(Function));
    expect(scrollToMock).not.toHaveBeenCalled();

    docAddSpy.mockRestore();
  });

  it("removes the visualViewport scroll and document focusin listeners on unmount", () => {
    setNavigatorStandalone(true);
    setInnerHeight(812);

    const fakeVisualViewport = {
      height: 812,
      scale: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: fakeVisualViewport,
    });

    const docAddSpy = vi.spyOn(document, "addEventListener");
    const docRemoveSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => useIosPwa());

    expect(fakeVisualViewport.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(docAddSpy).toHaveBeenCalledWith("focusin", expect.any(Function));

    unmount();

    expect(fakeVisualViewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(docRemoveSpy).toHaveBeenCalledWith("focusin", expect.any(Function));

    docAddSpy.mockRestore();
    docRemoveSpy.mockRestore();

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });
});

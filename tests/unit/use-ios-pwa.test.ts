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
});

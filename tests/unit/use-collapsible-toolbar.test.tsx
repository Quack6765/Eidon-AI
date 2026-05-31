// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { useCollapsibleToolbar } from "@/lib/use-collapsible-toolbar";

type FakeMql = {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  addListener: () => void;
  removeListener: () => void;
  dispatchEvent: () => boolean;
};

let currentMql: FakeMql | null = null;
let changeHandler: (() => void) | null = null;
const originalMatchMedia = window.matchMedia;

function installMatchMedia(matches: boolean) {
  changeHandler = null;
  currentMql = {
    matches,
    media: "(max-width: 767px)",
    onchange: null,
    addEventListener: (_type: string, cb: () => void) => {
      changeHandler = cb;
    },
    removeEventListener: () => {
      changeHandler = null;
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => currentMql)
  });
}

function removeMatchMedia() {
  delete (window as { matchMedia?: unknown }).matchMedia;
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia
  });
  currentMql = null;
  changeHandler = null;
  vi.useRealTimers();
});

describe("useCollapsibleToolbar", () => {
  it("always shows the toolbar when the feature is disabled, even on mobile", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useCollapsibleToolbar({ enabled: false }));
    expect(result.current.showToolbar).toBe(true);
  });

  it("always shows the toolbar when matchMedia is unavailable (treated as not mobile)", () => {
    removeMatchMedia();
    const { result } = renderHook(() => useCollapsibleToolbar({ enabled: true }));
    expect(result.current.showToolbar).toBe(true);
  });

  it("always shows the toolbar on a non-mobile viewport", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useCollapsibleToolbar({ enabled: true }));
    expect(result.current.showToolbar).toBe(true);
  });

  it("starts collapsed on mobile and expands on input focus", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useCollapsibleToolbar({ enabled: true }));
    expect(result.current.showToolbar).toBe(false);

    act(() => result.current.inputFocusProps.onFocus());
    expect(result.current.showToolbar).toBe(true);
  });

  it("collapses after blur once the delay elapses", () => {
    vi.useFakeTimers();
    installMatchMedia(true);
    const { result } = renderHook(() => useCollapsibleToolbar({ enabled: true }));

    act(() => result.current.inputFocusProps.onFocus());
    act(() => result.current.inputFocusProps.onBlur());
    expect(result.current.showToolbar).toBe(true);

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current.showToolbar).toBe(true);

    act(() => {
      vi.advanceTimersByTime(51);
    });
    expect(result.current.showToolbar).toBe(false);
  });

  it("does not collapse on blur while a control (dropdown) is open", () => {
    vi.useFakeTimers();
    installMatchMedia(true);
    const { result } = renderHook(() => useCollapsibleToolbar({ enabled: true }));

    act(() => result.current.inputFocusProps.onFocus());
    act(() => result.current.onControlOpenChange(true));
    act(() => result.current.inputFocusProps.onBlur());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.showToolbar).toBe(true);

    act(() => result.current.onControlOpenChange(false));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.showToolbar).toBe(false);
  });

  it("reacts to viewport changes via the media query listener", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useCollapsibleToolbar({ enabled: true }));
    expect(result.current.showToolbar).toBe(true);

    act(() => {
      if (currentMql) currentMql.matches = true;
      changeHandler?.();
    });
    expect(result.current.showToolbar).toBe(false);
  });

  it("clears the pending collapse timer on unmount", () => {
    vi.useFakeTimers();
    installMatchMedia(true);
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useCollapsibleToolbar({ enabled: true }));

    act(() => result.current.inputFocusProps.onFocus());
    act(() => result.current.inputFocusProps.onBlur());

    clearTimeoutSpy.mockClear();
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    expect(() => {
      vi.advanceTimersByTime(200);
    }).not.toThrow();

    clearTimeoutSpy.mockRestore();
  });
});

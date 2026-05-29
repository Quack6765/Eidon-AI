// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";

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

describe("useIosPwa", () => {
  afterEach(() => {
    setNavigatorStandalone(undefined);
    document.documentElement.classList.remove("ios-pwa");
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
});

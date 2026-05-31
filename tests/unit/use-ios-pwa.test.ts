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

describe("useIosPwa", () => {
  afterEach(() => {
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

  function setInnerHeight(value: number) {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value
    });
  }

  function appHeightVar() {
    return document.documentElement.style.getPropertyValue("--ios-app-height");
  }

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
});

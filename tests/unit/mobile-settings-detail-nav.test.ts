// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";

import { useMobileSettingsDetailNav } from "@/hooks/use-mobile-settings-detail-nav";
import {
  backMobileSettingsDetailNav,
  clearMobileSettingsDetailNav,
  getMobileSettingsDetailNavSnapshot,
  setMobileSettingsDetailNav,
  subscribeMobileSettingsDetailNav
} from "@/lib/mobile-settings-detail-nav";

describe("mobile settings detail nav store", () => {
  afterEach(() => {
    cleanup();
    clearMobileSettingsDetailNav();
  });

  it("publishes and clears the active detail", () => {
    expect(getMobileSettingsDetailNavSnapshot()).toBeNull();

    setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack: () => {} });
    expect(getMobileSettingsDetailNavSnapshot()).toEqual({
      title: "Web search",
      backLabel: "General"
    });

    clearMobileSettingsDetailNav();
    expect(getMobileSettingsDetailNavSnapshot()).toBeNull();
  });

  it("notifies subscribers only when the visible detail changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMobileSettingsDetailNav(listener);

    setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack: () => {} });
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();
    setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack: () => {} });
    expect(listener).not.toHaveBeenCalled();

    setMobileSettingsDetailNav({ title: "Speech-to-text", backLabel: "General", onBack: () => {} });
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();
    clearMobileSettingsDetailNav();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    listener.mockClear();
    setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack: () => {} });
    expect(listener).not.toHaveBeenCalled();
  });

  it("delegates back() to the most recently registered onBack", () => {
    const first = vi.fn();
    const second = vi.fn();

    setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack: first });
    backMobileSettingsDetailNav();
    expect(first).toHaveBeenCalledTimes(1);

    setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack: second });
    backMobileSettingsDetailNav();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    clearMobileSettingsDetailNav();
    backMobileSettingsDetailNav();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reflects store updates through the hook", () => {
    const { result } = renderHook(() => useMobileSettingsDetailNav());

    expect(result.current.detail).toBeNull();

    act(() => {
      setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack: () => {} });
    });
    expect(result.current.detail).toEqual({ title: "Web search", backLabel: "General" });

    act(() => {
      clearMobileSettingsDetailNav();
    });
    expect(result.current.detail).toBeNull();
  });

  it("invokes the registered onBack through the hook's back()", () => {
    const onBack = vi.fn();
    setMobileSettingsDetailNav({ title: "Web search", backLabel: "General", onBack });

    const { result } = renderHook(() => useMobileSettingsDetailNav());
    act(() => {
      result.current.back();
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

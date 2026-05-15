// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { useAutoResize } from "@/lib/use-auto-resize";

function createTextarea(scrollHeight: number) {
  const textarea = document.createElement("textarea");
  Object.defineProperty(textarea, "scrollHeight", {
    get: () => scrollHeight,
    configurable: true
  });
  vi.spyOn(textarea.style, "height", "set");
  return textarea;
}

describe("useAutoResize", () => {
  it("sets height to scrollHeight when content grows", () => {
    const textarea = createTextarea(120);
    const ref = { current: textarea };

    const { result } = renderHook(() =>
      useAutoResize({ ref, value: "hello\nworld" })
    );

    expect(result.current.height).toBe(120);
    expect(textarea.style.height).toBe("120px");
  });

  it("respects minHeight when scrollHeight is smaller", () => {
    const textarea = createTextarea(30);
    const ref = { current: textarea };

    const { result } = renderHook(() =>
      useAutoResize({ ref, value: "hi", minHeight: 52 })
    );

    expect(result.current.height).toBe(52);
    expect(textarea.style.height).toBe("52px");
  });

  it("adjusts height when value changes", () => {
    const textarea = createTextarea(80);
    const ref = { current: textarea };

    const { result, rerender } = renderHook(
      ({ value }) => useAutoResize({ ref, value }),
      { initialProps: { value: "short" } }
    );

    expect(result.current.height).toBe(80);

    Object.defineProperty(textarea, "scrollHeight", { get: () => 200, configurable: true });
    rerender({ value: "short\nmuch\nlonger\ntext\nhere" });

    expect(result.current.height).toBe(200);
    expect(textarea.style.height).toBe("200px");
  });

  it("shrinks back when text is deleted", () => {
    const textarea = createTextarea(200);
    const ref = { current: textarea };

    const { result, rerender } = renderHook(
      ({ value }) => useAutoResize({ ref, value }),
      { initialProps: { value: "long text" } }
    );

    expect(result.current.height).toBe(200);

    Object.defineProperty(textarea, "scrollHeight", { get: () => 80, configurable: true });
    rerender({ value: "short" });

    expect(result.current.height).toBe(80);
  });

  it("uses default minHeight of 52", () => {
    const textarea = createTextarea(30);
    const ref = { current: textarea };

    const { result } = renderHook(() =>
      useAutoResize({ ref, value: "" })
    );

    expect(result.current.height).toBe(52);
  });

  it("does nothing when ref.current is null", () => {
    const ref = { current: null };

    const { result } = renderHook(() =>
      useAutoResize({ ref, value: "hello" })
    );

    expect(result.current.height).toBe(52);
  });
});

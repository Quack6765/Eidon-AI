// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStableHandler } from "@/lib/use-stable-handler";

describe("useStableHandler", () => {
  it("returns a stable identity across re-renders", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useStableHandler(() => value),
      { initialProps: { value: 1 } }
    );
    const first = result.current;
    rerender({ value: 2 });
    expect(result.current).toBe(first);
  });

  it("always invokes the latest handler", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useStableHandler((factor: number) => value * factor),
      { initialProps: { value: 2 } }
    );
    expect(result.current(10)).toBe(20);
    rerender({ value: 5 });
    expect(result.current(10)).toBe(50);
  });
});

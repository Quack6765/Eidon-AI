// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@streamdown/mermaid", () => ({
  mermaid: { name: "mermaid", type: "diagram", language: "mermaid" }
}));

import { contentHasMermaid, useStreamdownPlugins } from "@/lib/streamdown-plugins";

describe("contentHasMermaid", () => {
  it("detects mermaid fences", () => {
    expect(contentHasMermaid("```mermaid\ngraph TD;\n```")).toBe(true);
    expect(contentHasMermaid("```ts\nconst a = 1;\n```")).toBe(false);
    expect(contentHasMermaid("plain text")).toBe(false);
  });
});

describe("useStreamdownPlugins", () => {
  it("returns only the code plugin for plain content", () => {
    const { result } = renderHook(() => useStreamdownPlugins("hello"));
    expect(Object.keys(result.current)).toEqual(["code"]);
  });

  it("loads the mermaid plugin when content contains a mermaid fence", async () => {
    const { result } = renderHook(() => useStreamdownPlugins("```mermaid\ngraph TD;\n```"));
    await waitFor(() => {
      expect(result.current.mermaid).toBeDefined();
    });
    expect(Object.keys(result.current).sort()).toEqual(["code", "mermaid"]);
  });
});

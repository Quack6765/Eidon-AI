// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const createMermaidPlugin = vi.hoisted(() =>
  vi.fn(
    (_options?: {
      config?: {
        htmlLabels?: boolean;
        themeVariables?: Record<string, string | boolean>;
      };
    }) => ({
      name: "mermaid",
      type: "diagram",
      language: "mermaid"
    })
  )
);

vi.mock("@streamdown/mermaid", () => ({
  mermaid: { name: "mermaid", type: "diagram", language: "mermaid" },
  createMermaidPlugin
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

  it("configures mermaid with the dark-aware theme palette", async () => {
    const { result } = renderHook(() => useStreamdownPlugins("```mermaid\ngraph TD;\n```"));
    await waitFor(() => {
      expect(result.current.mermaid).toBeDefined();
    });
    expect(createMermaidPlugin).toHaveBeenCalled();
    const themeVariables =
      createMermaidPlugin.mock.calls[0][0]?.config?.themeVariables ?? {};
    expect(themeVariables.darkMode).toBe(true);
    const options = createMermaidPlugin.mock.calls[0][0]?.config ?? {};
    expect(options.htmlLabels).toBe(false);
    expect(themeVariables.primaryTextColor).toBe("#0a0a0a");
    expect(themeVariables.textColor).toBe("#f4f4f5");
    expect(themeVariables.signalTextColor).toBe("#f4f4f5");
    expect(themeVariables.pieLegendTextColor).toBe("#f4f4f5");
    expect(themeVariables.taskTextOutsideColor).toBe("#f4f4f5");
  });
});

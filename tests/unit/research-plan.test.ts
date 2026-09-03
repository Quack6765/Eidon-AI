import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFallbackResearchPlan,
  buildResearchPlanningPrompt,
  generateResearchPlan,
  parseResearchPlanResponse
} from "@/lib/research-plan";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const { callProviderTextMock } = vi.hoisted(() => ({ callProviderTextMock: vi.fn() }));

vi.mock("@/lib/provider", () => ({
  callProviderText: callProviderTextMock
}));

describe("research plan generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a planning prompt around the request", () => {
    const prompt = buildResearchPlanningPrompt("  Compare heat pump subsidies  ");

    expect(prompt).toContain("JSON array of strings");
    expect(prompt.endsWith("Compare heat pump subsidies")).toBe(true);
  });

  it("parses JSON arrays out of noisy provider output", () => {
    expect(parseResearchPlanResponse('Here is the plan:\n["1. Find sources", " 2) Read them ", 3, ""]\nDone.')).toEqual([
      "Find sources",
      "Read them"
    ]);
    expect(parseResearchPlanResponse(JSON.stringify(Array.from({ length: 20 }, (_, i) => `step ${i}`)))).toHaveLength(12);
    expect(parseResearchPlanResponse(JSON.stringify(["x".repeat(900)]))![0]).toHaveLength(500);
  });

  it.each([
    ["no array", "just prose"],
    ["invalid JSON", "[not json"],
    ["non-array JSON", '{"plan": []}'],
    ["empty array", "[]"],
    ["no strings", "[1, 2]"]
  ])("returns null for %s", (_label, text) => {
    expect(parseResearchPlanResponse(text)).toBeNull();
  });

  it("derives a fallback plan from the request", () => {
    const plan = buildFallbackResearchPlan("  Compare   heat pump\nsubsidies ".padEnd(400, "x"));

    expect(plan).toHaveLength(4);
    expect(plan[0]).toContain("Compare heat pump subsidies");
    expect(plan[0].length).toBeLessThan(260);
  });

  it("asks the provider with the research planning purpose and parses its answer", async () => {
    callProviderTextMock.mockResolvedValue('["Find official pages", "Compare amounts"]');
    const settings = createRuntimeProviderProfile();

    await expect(generateResearchPlan({ message: "Compare subsidies", settings })).resolves.toEqual([
      "Find official pages",
      "Compare amounts"
    ]);
    expect(callProviderTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings,
        purpose: "research_planning",
        abortSignal: expect.any(AbortSignal)
      })
    );
  });

  it("falls back when the provider fails or returns garbage", async () => {
    const settings = createRuntimeProviderProfile();

    callProviderTextMock.mockRejectedValueOnce(new Error("provider down"));
    await expect(generateResearchPlan({ message: "Compare subsidies", settings })).resolves.toEqual(
      buildFallbackResearchPlan("Compare subsidies")
    );

    callProviderTextMock.mockResolvedValueOnce("no plan here");
    await expect(generateResearchPlan({ message: "Compare subsidies", settings })).resolves.toEqual(
      buildFallbackResearchPlan("Compare subsidies")
    );
  });
});

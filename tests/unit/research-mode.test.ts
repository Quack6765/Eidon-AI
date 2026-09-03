import { describe, expect, it } from "vitest";
import {
  RESEARCH_FINAL_ANSWER_DIRECTIVE,
  buildResearchDirective,
  collapseOlderToolResults,
  formatResearchPlan,
  parseResearchPlan,
  parseResearchRequest,
  resolveResearchStepBudget
} from "@/lib/research-mode";
import type { PromptMessage } from "@/lib/types";

describe("research plan parsing", () => {
  it("accepts 1-12 trimmed, non-empty steps of bounded length", () => {
    expect(parseResearchPlan(["  Compare pricing ", "Read reviews"])).toEqual(["Compare pricing", "Read reviews"]);
    expect(parseResearchPlan(Array.from({ length: 12 }, (_, index) => `step ${index}`))).toHaveLength(12);
    expect(parseResearchPlan(["x".repeat(500)])).toEqual(["x".repeat(500)]);
  });

  it.each([
    ["not an array", "plan"],
    ["empty array", []],
    ["13 steps", Array.from({ length: 13 }, (_, index) => `step ${index}`)],
    ["non-string item", ["ok", 42]],
    ["blank item", ["ok", "   "]],
    ["oversized item", ["x".repeat(501)]]
  ])("rejects %s", (_label, value) => {
    expect(parseResearchPlan(value)).toBeNull();
  });

  it("parses the research request envelope", () => {
    expect(parseResearchRequest(undefined)).toBeUndefined();
    expect(parseResearchRequest({})).toEqual({});
    expect(parseResearchRequest({ plan: ["a", "b"] })).toEqual({ plan: ["a", "b"] });
    expect(parseResearchRequest(null)).toBeNull();
    expect(parseResearchRequest(true)).toBeNull();
    expect(parseResearchRequest(["a"])).toBeNull();
    expect(parseResearchRequest({ plan: ["a"], deadlineMs: 1 })).toBeNull();
    expect(parseResearchRequest({ plan: [] })).toBeNull();
    expect(parseResearchRequest({ plan: [1] })).toBeNull();
  });
});

describe("research step budget", () => {
  it("multiplies the base budget and hard-caps it", () => {
    expect(resolveResearchStepBudget(25)).toBe(100);
    expect(resolveResearchStepBudget(30)).toBe(120);
    expect(resolveResearchStepBudget(1000)).toBe(120);
    expect(resolveResearchStepBudget(1)).toBe(4);
    expect(resolveResearchStepBudget(0)).toBe(1);
  });
});

describe("research directive", () => {
  it("embeds the numbered plan when one is provided", () => {
    const directive = buildResearchDirective(["Find pricing", "Compare features"]);

    expect(formatResearchPlan(["Find pricing", "Compare features"])).toBe("1. Find pricing\n2. Compare features");
    expect(directive).toContain("1. Find pricing\n2. Compare features");
    expect(directive).toContain("read_page");
    expect(directive).toContain("web_search");
    expect(directive).toContain("Sources list");
    expect(directive).not.toContain("Begin by writing a short numbered research plan");
  });

  it("asks the model to draft its own plan when none is provided", () => {
    expect(buildResearchDirective()).toContain("Begin by writing a short numbered research plan");
    expect(buildResearchDirective([])).toContain("Begin by writing a short numbered research plan");
    expect(RESEARCH_FINAL_ANSWER_DIRECTIVE).toContain("final research report");
  });
});

describe("collapseOlderToolResults", () => {
  const longResult = "r".repeat(2_000);
  const messages: PromptMessage[] = [
    { role: "system", content: "system" },
    { role: "user", content: "question" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "web_search", arguments: "{}" }] },
    { role: "tool", toolCallId: "c1", content: longResult },
    { role: "tool", toolCallId: "c1b", content: "short" },
    { role: "assistant", content: "digest one" },
    { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "read_page", arguments: "{}" }] },
    { role: "tool", toolCallId: "c2", content: longResult }
  ];

  it("shortens tool results from earlier rounds and keeps the latest round intact", () => {
    const collapsed = collapseOlderToolResults(messages);

    expect(collapsed[3].content).toHaveLength(400 + "\n[Earlier tool result collapsed to save context. Rely on the findings digest you wrote after that round.]".length);
    expect(String(collapsed[3].content).startsWith("r".repeat(400))).toBe(true);
    expect(collapsed[4]).toBe(messages[4]);
    expect(collapsed[5]).toBe(messages[5]);
    expect(collapsed[7]).toBe(messages[7]);
    expect(collapsed[0]).toBe(messages[0]);
  });

  it("returns the input unchanged when there is at most one tool round", () => {
    const single = messages.slice(0, 4);
    expect(collapseOlderToolResults(single)).toEqual(single);
    expect(collapseOlderToolResults([{ role: "user", content: "hi" }])).toEqual([{ role: "user", content: "hi" }]);
  });

  it("leaves structured tool content alone", () => {
    const structured: PromptMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "x", arguments: "{}" }] },
      { role: "tool", toolCallId: "c1", content: [{ type: "text", text: "t".repeat(2_000) }] },
      { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "x", arguments: "{}" }] },
      { role: "tool", toolCallId: "c2", content: "latest" }
    ];

    expect(collapseOlderToolResults(structured)[1]).toBe(structured[1]);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildCreateMemoryDescription,
  buildMemorySystemGuidance
} from "@/lib/memory-guidance";

describe("buildMemorySystemGuidance", () => {
  it.each(["low", "balanced", "high"] as const)(
    "states the global memory scope and litmus test at %s rigor",
    (rigor) => {
      const guidance = buildMemorySystemGuidance(rigor);
      expect(guidance).toContain("memory is global");
      expect(guidance).toContain(
        "would this fact matter in a future conversation about a completely different topic?"
      );
      expect(guidance).toContain("create_memory");
      expect(guidance).toContain("update_memory");
      expect(guidance).toContain("delete_memory");
    }
  );

  it("keeps the low rigor anchor and its restrictive stance", () => {
    const guidance = buildMemorySystemGuidance("low");
    expect(guidance).toContain(
      "Only propose a memory when the user explicitly asks"
    );
    expect(guidance).not.toContain("Proactively capture");
  });

  it("keeps the balanced rigor anchor and adds the user-not-topic rule", () => {
    const guidance = buildMemorySystemGuidance("balanced");
    expect(guidance).toContain("Proactively capture durable facts about the user");
    expect(guidance).toContain(
      "Memories must describe the user, not the topic under discussion"
    );
  });

  it("keeps the high rigor anchor while forbidding conversation content", () => {
    const guidance = buildMemorySystemGuidance("high");
    expect(guidance).toContain("Capture broadly and proactively");
    expect(guidance).toContain(
      "never about the content of the current conversation"
    );
    expect(guidance).not.toContain(
      "lean toward saving anything that could plausibly recur"
    );
  });

  it("falls back to balanced guidance for an unknown rigor", () => {
    expect(buildMemorySystemGuidance("unknown" as never)).toBe(
      buildMemorySystemGuidance("balanced")
    );
  });
});

describe("buildCreateMemoryDescription", () => {
  it.each(["low", "balanced", "high"] as const)(
    "frames memory as global at %s rigor",
    (rigor) => {
      expect(buildCreateMemoryDescription(rigor)).toContain(
        "global memory, shared across all conversations"
      );
    }
  );

  it("keeps distinct proactivity levels per rigor", () => {
    expect(buildCreateMemoryDescription("low")).toContain("Use rarely");
    expect(buildCreateMemoryDescription("balanced")).toContain(
      "Call this proactively"
    );
    expect(buildCreateMemoryDescription("high")).toContain("Be proactive");
  });

  it("falls back to the balanced description for an unknown rigor", () => {
    expect(buildCreateMemoryDescription("unknown" as never)).toBe(
      buildCreateMemoryDescription("balanced")
    );
  });
});

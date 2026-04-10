import { describe, expect, it } from "vitest";
import {
  buildCompactionSummaryPromptBody,
  extractArtifactReferences,
  extractOpenTasks,
  selectCompactionMemoryNodes
} from "@/lib/compaction-summary";
import type { MemoryNode } from "@/lib/types";

function makeNode(
  overrides: Partial<MemoryNode> & Pick<MemoryNode, "id" | "content" | "summaryTokenCount">
): MemoryNode {
  const base: MemoryNode = {
    id: overrides.id,
    conversationId: "conv_1",
    type: "leaf_summary",
    depth: 0,
    content: overrides.content,
    sourceStartMessageId: "msg_1",
    sourceEndMessageId: "msg_2",
    sourceTokenCount: 40,
    summaryTokenCount: overrides.summaryTokenCount,
    childNodeIds: [],
    supersededByNodeId: null,
    createdAt: "2026-04-10T10:00:00.000Z"
  };

  return {
    ...base,
    ...overrides
  };
}

describe("compaction summary helpers", () => {
  it("builds stable summary prompt headings and parses open tasks plus artifact refs", () => {
    const prompt = buildCompactionSummaryPromptBody({
      label: "completed chat turns",
      blocks: "[user] msg_1\nShip the feature",
      sourceSpan: {
        startMessageId: "msg_1",
        endMessageId: "msg_2",
        messageCount: 2
      }
    });

    expect(prompt).toContain("Goal:");
    expect(prompt).toContain("Constraints:");
    expect(prompt).toContain("Actions Taken:");
    expect(prompt).toContain("Outcomes:");
    expect(prompt).toContain("Open Tasks:");
    expect(prompt).toContain("Artifact References:");
    expect(prompt).toContain("Time Span:");

    const summary = [
      "Goal:",
      "- Keep compaction deterministic",
      "Constraints:",
      "- No external dependencies",
      "Actions Taken:",
      "- Added parser and selector",
      "Outcomes:",
      "- Summary format is now stable",
      "Open Tasks:",
      "- Verify browser validation",
      "1. Confirm prompt headings stay exact",
      "Artifact References:",
      "- lib/compaction.ts",
      "* tests/unit/compaction-summary.test.ts",
      "Time Span:",
      "- 2026-04-10T10:00:00.000Z -> 2026-04-10T10:05:00.000Z"
    ].join("\n");

    expect(extractOpenTasks(summary)).toEqual([
      "Verify browser validation",
      "Confirm prompt headings stay exact"
    ]);
    expect(extractArtifactReferences(summary)).toEqual([
      "lib/compaction.ts",
      "tests/unit/compaction-summary.test.ts"
    ]);
  });

  it("selects open-task nodes first, then artifact matches, then recency backfill within budget", () => {
    const nodes: MemoryNode[] = [
      makeNode({
        id: "mem_recent",
        content: [
          "Goal:",
          "- Review the latest branch",
          "Constraints:",
          "- Keep the scope tight",
          "Actions Taken:",
          "- Waited on validation",
          "Outcomes:",
          "- Nothing blocked",
          "Open Tasks:",
          "- None",
          "Artifact References:",
          "- docs/superpowers/plans/2026-04-10-autocompaction-hardening.md",
          "Time Span:",
          "- 2026-04-10T11:00:00.000Z -> 2026-04-10T11:05:00.000Z"
        ].join("\n"),
        summaryTokenCount: 30,
        createdAt: "2026-04-10T11:00:00.000Z"
      }),
      makeNode({
        id: "mem_open",
        content: [
          "Goal:",
          "- Finish the compaction work",
          "Constraints:",
          "- Do not change Task 5",
          "Actions Taken:",
          "- Added summary parsing",
          "Outcomes:",
          "- Parser is in place",
          "Open Tasks:",
          "- Wire deterministic selection into the current path",
          "Artifact References:",
          "- lib/compaction-summary.ts",
          "Time Span:",
          "- 2026-04-10T10:00:00.000Z -> 2026-04-10T10:10:00.000Z"
        ].join("\n"),
        summaryTokenCount: 40,
        createdAt: "2026-04-10T10:00:00.000Z"
      }),
      makeNode({
        id: "mem_artifact",
        content: [
          "Goal:",
          "- Track the prompt change",
          "Constraints:",
          "- Keep the change dependency-free",
          "Actions Taken:",
          "- Updated prompt headings",
          "Outcomes:",
          "- Stable summary blocks",
          "Open Tasks:",
          "- None",
          "Artifact References:",
          "- lib/compaction.ts",
          "- tests/unit/compaction.test.ts",
          "Time Span:",
          "- 2026-04-10T10:20:00.000Z -> 2026-04-10T10:25:00.000Z"
        ].join("\n"),
        summaryTokenCount: 35,
        createdAt: "2026-04-10T10:20:00.000Z"
      }),
      makeNode({
        id: "mem_backfill",
        content: [
          "Goal:",
          "- Keep the tail recent",
          "Constraints:",
          "- Preserve budget",
          "Actions Taken:",
          "- Reviewed older memory",
          "Outcomes:",
          "- Ready for fallback",
          "Open Tasks:",
          "- None",
          "Artifact References:",
          "- tests/unit/compaction-summary.test.ts",
          "Time Span:",
          "- 2026-04-10T11:10:00.000Z -> 2026-04-10T11:15:00.000Z"
        ].join("\n"),
        summaryTokenCount: 25,
        createdAt: "2026-04-10T11:10:00.000Z"
      })
    ];

    const selected = selectCompactionMemoryNodes({
      activeNodes: nodes,
      latestUserMessage: "Please review lib/compaction.ts and the compaction tests.",
      summaryTokenBudget: 100
    });

    expect(selected.map((node) => node.id)).toEqual([
      "mem_open",
      "mem_artifact",
      "mem_backfill"
    ]);
  });
});

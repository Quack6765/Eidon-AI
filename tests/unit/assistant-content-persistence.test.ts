import { describe, it, expect } from "vitest";

import { createAssistantContentPersistenceTracker } from "@/lib/chat-turn";
import { inferAssistantLocalAttachments } from "@/lib/assistant-local-attachments";

describe("assistant content persistence (chunked streaming)", () => {
  it("keeps the blank line between a rule and a heading when a flush splits the boundary", async () => {
    const tracker = createAssistantContentPersistenceTracker("conv_persist", "msg_persist");

    await tracker.appendSegment("Intro paragraph.\n\n---\n\n");
    await tracker.appendSegment("## Section\n\nBody paragraph.");

    const finalized = await tracker.finalize(
      "Intro paragraph.\n\n---\n\n## Section\n\nBody paragraph."
    );

    expect(finalized).toBe("Intro paragraph.\n\n---\n\n## Section\n\nBody paragraph.");
  });

  it("keeps list items on separate lines when a flush splits the boundary", async () => {
    const tracker = createAssistantContentPersistenceTracker("conv_persist", "msg_persist");

    const segmentA = await tracker.appendSegment("- First item ending mid thought\n\n");
    const segmentB = await tracker.appendSegment("- Second item on its own line");

    expect(segmentA + segmentB).toBe(
      "- First item ending mid thought\n\n- Second item on its own line"
    );
  });

  it("does not strip block-separating newlines from a single streamed chunk", async () => {
    const chunk = "Intro paragraph.\n\n---\n\n";

    const result = await inferAssistantLocalAttachments({
      conversationId: "conv_persist",
      content: chunk,
      workspaceRoot: process.cwd(),
      tidyWhitespace: false
    });

    expect(result.content).toBe(chunk);
  });

  it("trims only the outer whitespace of the assembled message at finalize", async () => {
    const tracker = createAssistantContentPersistenceTracker("conv_persist", "msg_persist");

    await tracker.appendSegment("\n\nHello world.\n\n");

    expect(await tracker.finalize("")).toBe("Hello world.");
  });

  it("keeps the streamed segments when the final answer diverges from them", async () => {
    const tracker = createAssistantContentPersistenceTracker("conv_persist", "msg_persist");

    await tracker.appendSegment("Streamed answer.");

    expect(await tracker.finalize("Totally different recovered answer.")).toBe("Streamed answer.");
  });

  it("persists the final answer when nothing was streamed beforehand", async () => {
    const tracker = createAssistantContentPersistenceTracker("conv_persist", "msg_persist");

    expect(await tracker.finalize("Only the final answer.")).toBe("Only the final answer.");
  });
});

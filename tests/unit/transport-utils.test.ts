import { NextResponse } from "next/server";

import { badRequest, ok } from "@/lib/http";
import { encodeSseEvent, encodeSseFlushMarker, encodeSsePrelude } from "@/lib/sse";
import { cn, formatTimestamp, normalizeLineBreaks, normalizeMarkdownLineBreaks } from "@/lib/utils";

describe("transport helpers", () => {
  it("creates json responses for success and failure", async () => {
    const success = ok({ hello: "world" });
    const failure = badRequest("broken");

    expect(success).toBeInstanceOf(NextResponse);
    await expect(success.json()).resolves.toEqual({ hello: "world" });
    await expect(failure.json()).resolves.toEqual({ error: "broken" });
    expect(failure.status).toBe(400);
  });

  it("encodes SSE events and utility helpers", () => {
    expect(
      encodeSseEvent({ type: "answer_delta", text: "Hi" })
    ).toBe('data: {"type":"answer_delta","text":"Hi"}\n\n');
    expect(encodeSsePrelude().startsWith(": ")).toBe(true);
    expect(encodeSsePrelude().endsWith("\n\n")).toBe(true);
    expect(encodeSsePrelude().length).toBe(2052);
    expect(encodeSseFlushMarker().startsWith(": ")).toBe(true);
    expect(encodeSseFlushMarker().endsWith("\n\n")).toBe(true);
    expect(encodeSseFlushMarker().length).toBe(516);
    expect(cn("a", undefined, "b")).toBe("a b");
    expect(formatTimestamp("2026-03-26T15:20:00.000Z")).toMatch(/Mar/);
    expect(normalizeLineBreaks("One\\nTwo")).toBe("One\nTwo");
    expect(normalizeLineBreaks("One\\\\nTwo")).toBe("One\nTwo");
    expect(normalizeMarkdownLineBreaks("One\\\\n\\\\n\\\\nTwo")).toBe("One\n\n\u00A0\n\nTwo");
  });
});

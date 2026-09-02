import { describe, expect, it } from "vitest";

import { buildBotAvatarColor, buildBotAvatarDataUrl, buildBotAvatarSvg } from "@/lib/bot-avatar";

describe("bot-avatar", () => {
  it("is deterministic for the same seed", () => {
    expect(buildBotAvatarSvg("seed-a")).toBe(buildBotAvatarSvg("seed-a"));
    expect(buildBotAvatarColor("seed-a")).toBe(buildBotAvatarColor("seed-a"));
  });

  it("produces valid svg markup with a palette color", () => {
    const svg = buildBotAvatarSvg("seed-b", 48);
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="48"');
    expect(svg).toContain("</svg>");
    expect(svg).toMatch(/#[0-9a-f]{6}/i);
  });

  it("varies across different seeds", () => {
    const avatars = new Set(
      Array.from({ length: 24 }, (_, index) => buildBotAvatarSvg(`seed-${index}`))
    );
    expect(avatars.size).toBeGreaterThan(1);
  });

  it("builds a data url embedding the svg", () => {
    const dataUrl = buildBotAvatarDataUrl("seed-c");
    expect(dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const decoded = Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
    expect(decoded).toContain("<svg");
  });
});

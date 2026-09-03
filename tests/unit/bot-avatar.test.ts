import { afterEach, describe, expect, it, vi } from "vitest";

import { buildBotAvatarUrl } from "@/lib/bot-avatar";
import { deleteBotAvatarSvg, ensureBotAvatarSvg } from "@/lib/bot-avatar-store";
import { getDb } from "@/lib/db";

const DICEBEAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" fill="#8b5cf6"/></svg>';

function diceBearResponse(body: string, ok = true) {
  return { ok, text: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bot avatar url", () => {
  it("builds a size-independent local url with an encoded seed", () => {
    expect(buildBotAvatarUrl("seed_abc")).toBe("/api/avatars/seed_abc.svg");
    expect(buildBotAvatarUrl("seed with spaces")).toBe(
      "/api/avatars/seed%20with%20spaces.svg"
    );
    expect(buildBotAvatarUrl("seed_abc")).toBe(buildBotAvatarUrl("seed_abc"));
  });
});

describe("bot avatar store", () => {
  it("fetches dicebear once with the styled bottts options and persists the svg", async () => {
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse(DICEBEAR_SVG));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureBotAvatarSvg("seed_a")).resolves.toBe(DICEBEAR_SVG);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url).startsWith("https://api.dicebear.com/10.x/bottts/svg?")).toBe(true);
    const query = new URL(String(url)).searchParams;
    expect(query.get("seed")).toBe("seed_a");
    expect(query.get("size")).toBe("512");
    expect(query.get("baseColor")).toMatch(/^(8b5cf6|a78bfa|818cf8|6366f1|22d3ee|14b8a6|10b981|f59e0b|f472b6)$/);
    expect(["circuits", "dots"]).toContain(query.get("textureVariant"));
    expect(String(url)).not.toContain(",");

    const stored = getDb()
      .prepare("SELECT svg FROM bot_avatars WHERE seed = ?")
      .get("seed_a") as { svg: string };
    expect(stored.svg).toBe(DICEBEAR_SVG);

    await expect(ensureBotAvatarSvg("seed_a")).resolves.toBe(DICEBEAR_SVG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null without storing when the api responds with an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse("nope", false));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureBotAvatarSvg("seed_b")).resolves.toBeNull();
    expect(
      getDb().prepare("SELECT 1 FROM bot_avatars WHERE seed = ?").get("seed_b")
    ).toBeUndefined();
  });

  it("returns null without storing when the api payload is not an svg", async () => {
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse("<html>not a robot</html>"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureBotAvatarSvg("seed_c")).resolves.toBeNull();
    expect(
      getDb().prepare("SELECT 1 FROM bot_avatars WHERE seed = ?").get("seed_c")
    ).toBeUndefined();
  });

  it("returns null without storing when the api payload exceeds the size cap", async () => {
    const oversized = `<svg>${"x".repeat(1_000_001)}</svg>`;
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse(oversized));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureBotAvatarSvg("seed_big")).resolves.toBeNull();
    expect(
      getDb().prepare("SELECT 1 FROM bot_avatars WHERE seed = ?").get("seed_big")
    ).toBeUndefined();
  });

  it("returns null without storing when the fetch fails or times out", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureBotAvatarSvg("seed_d")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      getDb().prepare("SELECT 1 FROM bot_avatars WHERE seed = ?").get("seed_d")
    ).toBeUndefined();
  });

  it("deletes a stored avatar so the next request regenerates it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse(DICEBEAR_SVG));
    vi.stubGlobal("fetch", fetchMock);

    await ensureBotAvatarSvg("seed_e");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    deleteBotAvatarSvg("seed_e");
    deleteBotAvatarSvg("seed_never_stored");
    expect(
      getDb().prepare("SELECT 1 FROM bot_avatars WHERE seed = ?").get("seed_e")
    ).toBeUndefined();

    await expect(ensureBotAvatarSvg("seed_e")).resolves.toBe(DICEBEAR_SVG);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

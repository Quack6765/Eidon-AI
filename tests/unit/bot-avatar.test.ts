import { afterEach, describe, expect, it, vi } from "vitest";

import { AVATAR_ART, AVATAR_BODY_COLORS, AVATAR_DICEBEAR_STYLE, AVATAR_TOP_VARIANTS, AVATAR_VIEWBOX, applyAvatarViewBox, assertSafeInlineSvg, buildAnimatedBotAvatarUrl, buildBotAvatarUrl, stripAvatarAnimationStyle, wrapAvatarEyes } from "@/lib/bot-avatar";
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
    expect(buildBotAvatarUrl("seed_abc")).toBe(`/api/avatars/seed_abc.svg?v=${AVATAR_ART}`);
    expect(buildBotAvatarUrl("seed with spaces")).toBe(
      `/api/avatars/seed%20with%20spaces.svg?v=${AVATAR_ART}`
    );
    expect(buildBotAvatarUrl("seed_abc")).toBe(buildBotAvatarUrl("seed_abc"));
    expect(buildAnimatedBotAvatarUrl("seed_abc")).toBe(
      `/api/avatars/seed_abc.svg?v=${AVATAR_ART}&animated=1`
    );
  });

  it("versions the url by style so an immutable cache cannot pin a previous avatar", () => {
    expect(buildBotAvatarUrl("seed_abc")).toContain(`v=${AVATAR_ART}`);
    expect(buildBotAvatarUrl("seed_abc")).not.toBe("/api/avatars/seed_abc.svg");
  });
});

describe("avatar animation style stripping", () => {
  it("removes the embedded stylesheet so a still portrait cannot animate itself", () => {
    const withStyle =
      '<svg viewBox="0 0 128 128"><style>@keyframes vb-blink{0%{opacity:0}}</style><g class="vb-head"><path d="M0 0"/></g></svg>';
    const stripped = stripAvatarAnimationStyle(withStyle);
    expect(stripped).not.toContain("<style");
    expect(stripped).not.toContain("@keyframes");
    expect(stripped).toContain('class="vb-head"');
  });

  it("removes every style block, not just the first", () => {
    const svg = '<svg><style>a{}</style><g/><style>b{}</style></svg>';
    expect(stripAvatarAnimationStyle(svg)).not.toContain("<style");
  });
});

describe("avatar eye wrapper", () => {
  it("wraps the eye use in an animatable group and keeps its placement transform", () => {
    const wrapped = wrapAvatarEyes(
      '<svg viewBox="0 0 128 128"><use transform="translate(29 44)" href="#eyes-visor-1"/></svg>'
    );
    expect(wrapped).toContain('<g class="bot-eyes">');
    expect(wrapped).toContain('<use transform="translate(29 44)" href="#eyes-visor-1"/>');
  });

  it("leaves an svg without an eye use untouched", () => {
    const svg = '<svg viewBox="0 0 128 128"><path d="M0 0"/></svg>';
    expect(wrapAvatarEyes(svg)).toBe(svg);
  });
});

describe("bot avatar store", () => {
  it("wraps the eyes only on the animated variant so still portraits stay minimal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        diceBearResponse(
          '<svg viewBox="0 0 128 128"><use transform="translate(29 44)" href="#eyes-visor-1"/></svg>'
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureBotAvatarSvg("seed_eyes")).resolves.not.toContain("bot-eyes");
    await expect(ensureBotAvatarSvg("seed_eyes", true)).resolves.toContain(
      '<g class="bot-eyes">'
    );
  });

  it("fetches dicebear once with the styled voxel-bot options and persists the svg", async () => {
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse(DICEBEAR_SVG));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureBotAvatarSvg("seed_a")).resolves.toBe(applyAvatarViewBox(DICEBEAR_SVG));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url).startsWith(`https://api.dicebear.com/10.x/${AVATAR_DICEBEAR_STYLE}/svg?`)).toBe(true);
    const query = new URL(String(url)).searchParams;
    expect(query.get("seed")).toBe("seed_a");
    expect(query.get("size")).toBe("512");
    expect(query.get("animationVariant")).toBe("none");
    expect(query.get("backgroundColor")).toBe("00000000");
    expect(AVATAR_BODY_COLORS).toContain(query.get("bodyColor"));
    expect(AVATAR_TOP_VARIANTS).toContain(query.get("topVariant"));
    expect(String(url)).not.toContain(",");

    const stored = getDb()
      .prepare("SELECT svg FROM bot_avatars WHERE seed = ? AND style = ? AND variant = ?")
      .get("seed_a", AVATAR_ART, "static") as { svg: string };
    expect(stored.svg).toBe(applyAvatarViewBox(DICEBEAR_SVG));
    expect(stored.svg).toContain(`viewBox="${AVATAR_VIEWBOX}"`);
    expect(stored.svg).not.toContain('viewBox="0 0 180 180"');

    await expect(ensureBotAvatarSvg("seed_a")).resolves.toBe(applyAvatarViewBox(DICEBEAR_SVG));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests a still portrait by default and the animated variant on demand", async () => {
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse(DICEBEAR_SVG));
    vi.stubGlobal("fetch", fetchMock);

    await ensureBotAvatarSvg("seed_v");
    await ensureBotAvatarSvg("seed_v", true);

    const staticParams = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    const animatedParams = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(staticParams.get("animationVariant")).toBe("none");
    expect(animatedParams.get("animationVariant")).toBe("medium");
    expect(staticParams.get("seed")).toBe(animatedParams.get("seed"));
    expect(staticParams.get("bodyColor")).toBe(animatedParams.get("bodyColor"));
    expect(staticParams.get("topVariant")).toBe(animatedParams.get("topVariant"));

    const rows = getDb()
      .prepare("SELECT variant FROM bot_avatars WHERE seed = ? AND style = ? ORDER BY variant")
      .all("seed_v", AVATAR_ART) as Array<{ variant: string }>;
    expect(rows.map((row) => row.variant)).toEqual(["animated", "static"]);
  });

  it("does not reuse a cached svg stored under a different style", async () => {
    const fetchMock = vi.fn().mockResolvedValue(diceBearResponse(DICEBEAR_SVG));
    vi.stubGlobal("fetch", fetchMock);

    getDb()
      .prepare(
        "INSERT OR REPLACE INTO bot_avatars (seed, style, variant, svg, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("seed_stale", "some-other-style", "static", "<svg>stale</svg>", new Date().toISOString());

    await expect(ensureBotAvatarSvg("seed_stale")).resolves.toBe(applyAvatarViewBox(DICEBEAR_SVG));
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

    await expect(ensureBotAvatarSvg("seed_e")).resolves.toBe(applyAvatarViewBox(DICEBEAR_SVG));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

const REAL_DICEBEAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><g id="eyes-round-2fc"><g class="vb-eye"><path d="M1 1h5" fill="#69db7c"/></g></g><g id="animation-medium-2fc"><style>.vb-blink-medium{animation:vb-blink 4.5s linear infinite}</style><path class="vb-blink-medium" opacity="0" d="M34 44h50v15H34z"/></g></defs><g clip-path="url(#clip-2fc)"><g class="vb-head"><use href="#eyes-round-2fc"/><use href="#animation-medium-2fc"/></g></g></svg>';

describe("inline avatar svg safety", () => {
  it("accepts a real avatar svg carrying styles, classes and fragment references", () => {
    expect(assertSafeInlineSvg(REAL_DICEBEAR_SVG)).toBe(REAL_DICEBEAR_SVG);
  });

  it.each([
    ["script element", '<svg><script>alert(1)</script></svg>'],
    ["foreignObject", "<svg><foreignObject><div/></foreignObject></svg>"],
    ["iframe", "<svg><iframe/></svg>"],
    ["image", '<svg><image href="x.png"/></svg>'],
    ["animate", '<svg><animate attributeName="x"/></svg>'],
    ["set", "<svg><set/></svg>"],
    ["event handler", '<svg onload="alert(1)"></svg>'],
    ["javascript url", '<svg><a href="javascript:alert(1)">x</a></svg>'],
    ["external reference", '<svg><use href="https://evil.test/x.svg#a"/></svg>'],
    ["external xlink reference", '<svg><use xlink:href="https://evil.test/x.svg#a"/></svg>']
  ])("rejects an svg containing a %s", (_label, svg) => {
    expect(assertSafeInlineSvg(svg)).toBeNull();
  });

  it("rejects payloads that are not svg markup at all", () => {
    expect(assertSafeInlineSvg(null)).toBeNull();
    expect(assertSafeInlineSvg("<html>nope</html>")).toBeNull();
  });
});

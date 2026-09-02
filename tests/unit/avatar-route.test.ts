import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as avatarRoute } from "@/app/api/avatars/[seed]/route";
import { buildBotAvatarUrl } from "@/lib/bot-avatar";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({
    id: "user_test",
    username: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  })
}));

const ensureBotAvatarSvg = vi.fn();
vi.mock("@/lib/bot-avatar-store", () => ({
  ensureBotAvatarSvg: (...args: unknown[]) => ensureBotAvatarSvg(...args),
  deleteBotAvatarSvg: vi.fn()
}));

function avatarRequest(seed: string) {
  return avatarRoute(new Request("http://localhost/api/avatars/x.svg"), {
    params: Promise.resolve({ seed })
  });
}

beforeEach(() => {
  ensureBotAvatarSvg.mockReset();
});

describe("avatar route", () => {
  it("serves the generated avatar with immutable cache headers", async () => {
    ensureBotAvatarSvg.mockResolvedValueOnce("<svg>robot</svg>");

    const response = await avatarRequest("seed_x");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    await expect(response.text()).resolves.toBe("<svg>robot</svg>");
    expect(ensureBotAvatarSvg).toHaveBeenCalledWith("seed_x");
  });

  it("accepts the .svg-suffixed segment produced by the url builder", async () => {
    ensureBotAvatarSvg.mockResolvedValueOnce("<svg>robot</svg>");

    const path = buildBotAvatarUrl("seed_x");
    const segment = path.split("/").pop() ?? "";
    const response = await avatarRoute(new Request(`http://localhost${path}`), {
      params: Promise.resolve({ seed: segment })
    });

    expect(response.status).toBe(200);
    expect(ensureBotAvatarSvg).toHaveBeenCalledWith("seed_x");
  });

  it("rejects seeds outside the allowed alphabet", async () => {
    const response = await avatarRequest("bad seed!");

    expect(response.status).toBe(400);
    expect(ensureBotAvatarSvg).not.toHaveBeenCalled();
  });

  it("returns 503 with no-store when generation fails", async () => {
    ensureBotAvatarSvg.mockResolvedValueOnce(null);

    const response = await avatarRequest("seed_y");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

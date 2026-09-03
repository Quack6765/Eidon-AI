import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CHAT_REQUEST_BYTES } from "@/lib/constants";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const { requireUserMock, getRuntimeProviderProfileMock, getDefaultRuntimeProviderProfileMock, generateResearchPlanMock } =
  vi.hoisted(() => ({
    requireUserMock: vi.fn(),
    getRuntimeProviderProfileMock: vi.fn(),
    getDefaultRuntimeProviderProfileMock: vi.fn(),
    generateResearchPlanMock: vi.fn()
  }));

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/settings", () => ({
  getRuntimeProviderProfile: getRuntimeProviderProfileMock,
  getDefaultRuntimeProviderProfile: getDefaultRuntimeProviderProfileMock
}));
vi.mock("@/lib/research-plan", () => ({ generateResearchPlan: generateResearchPlanMock }));

function post(body: unknown, raw = false) {
  return new Request("http://localhost/api/research/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body)
  });
}

describe("POST /api/research/plan", () => {
  const defaultProfile = createRuntimeProviderProfile({ id: "profile_default" });
  const pinnedProfile = createRuntimeProviderProfile({ id: "profile_pinned" });

  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ id: "user_1" });
    getDefaultRuntimeProviderProfileMock.mockReturnValue(defaultProfile);
    getRuntimeProviderProfileMock.mockImplementation((id: string) => (id === "profile_pinned" ? pinnedProfile : null));
    generateResearchPlanMock.mockResolvedValue(["Find sources", "Compare them"]);
  });

  it("requires an authenticated session", async () => {
    requireUserMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/research/plan/route");

    const response = await POST(post({ message: "Research this" }));

    expect(response.status).toBe(401);
    expect(generateResearchPlanMock).not.toHaveBeenCalled();
  });

  it("returns the generated plan using the requested or default profile", async () => {
    const { POST } = await import("@/app/api/research/plan/route");

    const pinned = await POST(post({ message: "Research this", providerProfileId: "profile_pinned" }));
    expect(pinned.status).toBe(200);
    await expect(pinned.json()).resolves.toEqual({ plan: ["Find sources", "Compare them"] });
    expect(generateResearchPlanMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Research this", settings: pinnedProfile })
    );

    await POST(post({ message: "Research this", providerProfileId: "profile_missing" }));
    expect(generateResearchPlanMock).toHaveBeenLastCalledWith(expect.objectContaining({ settings: defaultProfile }));

    await POST(post({ message: "  Research this  " }));
    expect(generateResearchPlanMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Research this", settings: defaultProfile })
    );
  });

  it("rejects invalid, oversized, and unparseable bodies", async () => {
    const { POST } = await import("@/app/api/research/plan/route");

    expect((await POST(post({ message: "   " }))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ message: "ok", providerProfileId: 5 }))).status).toBe(400);
    expect((await POST(post("{not json", true))).status).toBe(400);
    expect((await POST(post(JSON.stringify({ message: "x".repeat(MAX_CHAT_REQUEST_BYTES + 10) }), true))).status).toBe(413);
    expect(generateResearchPlanMock).not.toHaveBeenCalled();
  });

  it("fails cleanly when no provider profile exists", async () => {
    getDefaultRuntimeProviderProfileMock.mockReturnValue(null);
    const { POST } = await import("@/app/api/research/plan/route");

    const response = await POST(post({ message: "Research this" }));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("No provider profile configured");
  });
});

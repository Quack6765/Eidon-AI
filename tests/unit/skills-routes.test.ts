import { deleteSkill, getSkill } from "@/lib/skills";
import type { Skill } from "@/lib/types";

const { requireAdminResponseMock } = vi.hoisted(() => ({
  requireAdminResponseMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAdminResponse: requireAdminResponseMock
}));

describe("skills routes", () => {
  beforeEach(() => {
    requireAdminResponseMock.mockReset();
    requireAdminResponseMock.mockResolvedValue({
      id: "user_admin",
      username: "admin",
      role: "admin",
      authSource: "env_super_admin",
      passwordManagedBy: "env",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("creates a disabled skill atomically", async () => {
    const { POST } = await import("@/app/api/skills/route");
    const response = await POST(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Paused",
          description: "Use after this skill is enabled.",
          content: "Wait until enabled.",
          enabled: false
        })
      })
    );
    const body = await response.json() as { skill: Skill };

    expect(response.status).toBe(201);
    expect(body.skill.enabled).toBe(false);
    expect(getSkill(body.skill.id)?.enabled).toBe(false);

    deleteSkill(body.skill.id);
  });
});

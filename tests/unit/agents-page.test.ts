import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureChiefBot } from "@/lib/bots";
import { createLocalUser } from "@/lib/users";

const { requireUserMock, redirectMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  })
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: requireUserMock
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: redirectMock
}));

vi.mock("@/components/shell", () => ({ Shell: () => null }));
vi.mock("@/components/agents/agents-workspace", () => ({ AgentsWorkspace: () => null }));

describe("agents section entry", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    redirectMock.mockClear();
  });

  it("lands on the chief of staff conversation, not the roster", async () => {
    const user = await createLocalUser({ username: "agents-default-owner", password: "Password123!", role: "user" });
    requireUserMock.mockResolvedValue(user);
    const chief = ensureChiefBot(user.id);

    const { default: AgentsPage } = await import("@/app/agents/page");
    await expect(AgentsPage()).rejects.toThrow(`NEXT_REDIRECT /agents/${chief.id}`);
  });

  it("keeps the roster available at /agents/roster without redirecting", async () => {
    const user = await createLocalUser({ username: "agents-roster-owner", password: "Password123!", role: "user" });
    requireUserMock.mockResolvedValue(user);

    const { default: AgentsRosterPage } = await import("@/app/agents/roster/page");
    await expect(AgentsRosterPage()).resolves.toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

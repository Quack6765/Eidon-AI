// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { SettingsNav } from "@/components/settings/settings-nav";

const mockPush = vi.fn();
let mockPathname = "/settings/general";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush
  })
}));

function buildUser(overrides: Partial<Parameters<typeof SettingsNav>[0]["currentUser"]> = {}) {
  return {
    id: "user_admin",
    username: "admin",
    role: "admin" as const,
    authSource: "env_super_admin" as const,
    passwordManagedBy: "env" as const,
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    ...overrides
  };
}

describe("settings nav", () => {
  beforeEach(() => {
    mockPathname = "/settings/general";
    mockPush.mockReset();
  });

  it("shows admin-only items only for admins when password login is enabled", () => {
    render(
      <SettingsNav
        currentUser={buildUser()}
        passwordLoginEnabled
        onCloseAction={() => {}}
      />
    );

    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Providers")).toBeInTheDocument();
    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("hides admin-only items for regular users", () => {
    render(
      <SettingsNav
        currentUser={buildUser({
          id: "user_member",
          username: "member",
          role: "user",
          authSource: "local",
          passwordManagedBy: "local"
        })}
        passwordLoginEnabled
        onCloseAction={() => {}}
      />
    );

    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Providers")).not.toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { AccountSection } from "@/components/settings/sections/account-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

function buildUser(
  overrides: Partial<Parameters<typeof AccountSection>[0]["user"]> = {}
) {
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

describe("account section", () => {
  it("disables credential editing for env-managed users", () => {
    render(<AccountSection user={buildUser()} />);

    expect(screen.getByText(/managed by environment variables/i)).toBeInTheDocument();
    expect(screen.queryByText("New password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows password editing controls for local users", () => {
    render(
      <AccountSection
        user={buildUser({
          id: "user_member",
          username: "member",
          role: "user",
          authSource: "local",
          passwordManagedBy: "local"
        })}
      />
    );

    expect(screen.getByText("New password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update account" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });
});

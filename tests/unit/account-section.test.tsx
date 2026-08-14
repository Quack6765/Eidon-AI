// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

function renderLocalUser() {
  return render(
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
}

describe("account section", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ success: true })
      } as Response;
    }) as typeof fetch;
  });

  it("disables credential editing for env-managed users", () => {
    render(<AccountSection user={buildUser()} />);

    expect(screen.getByText(/managed by environment variables/i)).toBeInTheDocument();
    expect(screen.queryByText("New password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows password editing controls for local users", () => {
    renderLocalUser();

    expect(screen.getByText("New password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("requires the current password for local users", () => {
    renderLocalUser();

    const currentPassword = screen.getByLabelText("Current password");
    expect(currentPassword).toHaveAttribute("type", "password");
    expect(currentPassword).toBeRequired();
    expect(screen.queryByText("Current password")).toBeInTheDocument();
  });

  it("submits the current password with account changes", async () => {
    renderLocalUser();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "current-secret-123" }
    });
    fireEvent.change(screen.getByPlaceholderText("Enter a new password"), {
      target: { value: "new-secret-456" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/account",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            username: "member",
            password: "new-secret-456",
            currentPassword: "current-secret-123"
          })
        })
      );
    });
  });
});

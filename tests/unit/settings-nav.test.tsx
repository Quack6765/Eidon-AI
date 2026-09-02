// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsNav } from "@/components/settings/settings-nav";
import { registerUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";

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
    sessionStorage.clear();
    registerUnsavedChangesGuard(null);
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
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Automation")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("does not navigate when saving unsaved settings fails", async () => {
    const save = vi.fn().mockResolvedValue(false);
    registerUnsavedChangesGuard({
      isDirty: () => true,
      save,
      discard: vi.fn(),
      entityType: "these settings"
    });
    render(
      <SettingsNav
        currentUser={buildUser()}
        passwordLoginEnabled
        onCloseAction={() => {}}
      />
    );

    fireEvent.click(screen.getByText("Personas"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });

  it("does not navigate when the registered save rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("network down"));
    registerUnsavedChangesGuard({
      isDirty: () => true,
      save,
      discard: vi.fn(),
      entityType: "these settings"
    });
    render(
      <SettingsNav
        currentUser={buildUser()}
        passwordLoginEnabled
        onCloseAction={() => {}}
      />
    );

    fireEvent.click(screen.getByText("Personas"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });

  it("returns to the view the user came from when clicking back", () => {
    sessionStorage.setItem("eidon:settings:origin", "/agents");
    render(
      <SettingsNav
        currentUser={buildUser()}
        passwordLoginEnabled
        onCloseAction={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockPush).toHaveBeenCalledWith("/agents");
    expect(sessionStorage.getItem("eidon:settings:origin")).toBeNull();
  });

  it("falls back to the home route when no origin is recorded", () => {
    render(
      <SettingsNav
        currentUser={buildUser()}
        passwordLoginEnabled
        onCloseAction={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockPush).toHaveBeenCalledWith("/");
  });
});

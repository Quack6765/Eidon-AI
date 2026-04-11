// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { UsersSection } from "@/components/settings/sections/users-section";

describe("users section", () => {
  it("renders the env super-admin row as protected", () => {
    render(
      <UsersSection
        users={[
          {
            id: "user_admin",
            username: "admin",
            role: "admin",
            authSource: "env_super_admin",
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(screen.getByText(/protected from ui edits/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { LoginForm } from "@/components/login-form";

describe("login form", () => {
  it("renders the approved quote in italic with the new proceed button", () => {
    render(<LoginForm />);

    expect(
      screen.getByText("The seeker enters in uncertainty and departs in knowing.")
    ).toHaveClass("italic");
    expect(screen.getByRole("button", { name: "Proceed" })).toBeInTheDocument();
  });
});

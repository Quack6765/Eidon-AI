// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { LoginForm } from "@/components/login-form";

describe("login form", () => {
  it("renders the proceed button", () => {
    render(<LoginForm />);

    expect(screen.getByRole("button", { name: "Proceed" })).toBeInTheDocument();
  });

  it("renders the three decorative bot faces above the wordmark", () => {
    const { container } = render(<LoginForm />);

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(3);

    const sources = Array.from(images).map((image) => image.getAttribute("src"));
    expect(sources).toEqual(["/bots/bot-teal.svg", "/bots/bot-violet.svg", "/bots/bot-pink.svg"]);

    for (const image of images) {
      expect(image).toHaveAttribute("alt", "");
    }

    const botsRow = images[0].parentElement;
    expect(botsRow).toHaveAttribute("aria-hidden", "true");
    expect(botsRow?.compareDocumentPosition(screen.getByText("Eidon"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});

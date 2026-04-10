// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { SidebarFooterNav } from "@/components/sidebar-footer-nav";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);

        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          event.preventDefault();
        }
      }}
      {...props}
    >
      {children}
    </a>
  )
}));

describe("SidebarFooterNav", () => {
  it("renders Automations above Settings with the correct hrefs", () => {
    render(<SidebarFooterNav onNavigateAction={vi.fn()} />);

    const automationsLink = screen.getByRole("link", { name: "Open automations" });
    const settingsLink = screen.getByRole("link", { name: "Open settings" });

    expect(automationsLink).toHaveAttribute("href", "/automations");
    expect(settingsLink).toHaveAttribute("href", "/settings");
    expect(
      automationsLink.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("delegates plain left-click navigation through the provided action", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open automations" }), { button: 0 });

    expect(onNavigateAction).toHaveBeenCalledWith("/automations");
  });

  it("does not intercept modified clicks", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open settings" }), {
      button: 0,
      metaKey: true
    });

    expect(onNavigateAction).not.toHaveBeenCalled();
  });
});

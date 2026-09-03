// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { SidebarFooterNav } from "@/components/sidebar-footer-nav";

let mockPathname = "/agents";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname
}));

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
  beforeEach(() => {
    mockPathname = "/agents";
    sessionStorage.clear();
  });

  it("records the current view as the settings origin when opening settings", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav currentView="agents" onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open settings" }), { button: 0 });

    expect(sessionStorage.getItem("eidon:settings:origin")).toBe("/agents");
    expect(onNavigateAction).toHaveBeenCalledWith("/settings");
  });

  it("does not record a settings origin when navigating between views", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav currentView="agents" onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open chat" }), { button: 0 });

    expect(sessionStorage.getItem("eidon:settings:origin")).toBeNull();
    expect(onNavigateAction).toHaveBeenCalledWith("/chat");
  });
  it("renders Settings last with the correct hrefs", () => {
    render(<SidebarFooterNav currentView="chat" onNavigateAction={vi.fn()} />);

    const automationsLink = screen.getByRole("link", { name: "Open automations" });
    const settingsLink = screen.getByRole("link", { name: "Open settings" });

    expect(automationsLink).toHaveAttribute("href", "/automations");
    expect(settingsLink).toHaveAttribute("href", "/settings");
    expect(
      automationsLink.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders the Agents entry before Automations", () => {
    render(<SidebarFooterNav currentView="chat" onNavigateAction={vi.fn()} />);

    const agentsLink = screen.getByRole("link", { name: "Open agents" });
    const automationsLink = screen.getByRole("link", { name: "Open automations" });
    const settingsLink = screen.getByRole("link", { name: "Open settings" });

    expect(agentsLink).toHaveAttribute("href", "/agents");
    expect(
      agentsLink.compareDocumentPosition(automationsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      automationsLink.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("delegates plain left-click navigation through the provided action", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav currentView="chat" onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open automations" }), { button: 0 });

    expect(onNavigateAction).toHaveBeenCalledWith("/automations");
  });

  it("does not intercept modified clicks", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav currentView="chat" onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open settings" }), {
      button: 0,
      metaKey: true
    });

    expect(onNavigateAction).not.toHaveBeenCalled();
  });

  it("hides the current view and links Chat to the chat route from the agents nav", () => {
    render(<SidebarFooterNav currentView="agents" onNavigateAction={vi.fn()} />);

    expect(screen.queryByRole("link", { name: "Open agents" })).not.toBeInTheDocument();

    const chatLink = screen.getByRole("link", { name: "Open chat" });
    const automationsLink = screen.getByRole("link", { name: "Open automations" });
    const settingsLink = screen.getByRole("link", { name: "Open settings" });

    expect(chatLink).toHaveAttribute("href", "/chat");
    expect(
      chatLink.compareDocumentPosition(automationsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      automationsLink.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("hides the current view and links Chat to the chat route from the automations nav", () => {
    render(<SidebarFooterNav currentView="automations" onNavigateAction={vi.fn()} />);

    expect(screen.queryByRole("link", { name: "Open automations" })).not.toBeInTheDocument();

    const chatLink = screen.getByRole("link", { name: "Open chat" });
    const agentsLink = screen.getByRole("link", { name: "Open agents" });
    const settingsLink = screen.getByRole("link", { name: "Open settings" });

    expect(chatLink).toHaveAttribute("href", "/chat");
    expect(
      chatLink.compareDocumentPosition(agentsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      agentsLink.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

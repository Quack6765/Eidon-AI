// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Shell } from "@/components/shell";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar">Sidebar</aside>,
}));

vi.mock("@/components/settings/settings-nav", () => ({
  SettingsNav: () => <aside data-testid="settings-nav">SettingsNav</aside>,
}));

vi.mock("@/components/automations/automations-nav", () => ({
  AutomationsNav: () => <aside data-testid="automations-nav">AutomationsNav</aside>,
}));

vi.mock("@/lib/context-tokens-context", () => ({
  ContextTokensProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/conversation-drafts", () => ({
  deleteConversationIfStillEmpty: vi.fn(),
}));

vi.mock("@/lib/ws-client", () => ({
  useGlobalWebSocket: vi.fn(),
}));

const mockProps = {
  currentUser: {
    id: "u1",
    username: "testuser",
    role: "user" as const,
    authSource: "local" as const,
    passwordManagedBy: "local" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  passwordLoginEnabled: true,
  conversationPage: { conversations: [], nextCursor: null, hasMore: false },
  folders: [],
  automations: [],
  children: <div data-testid="main">Main Content</div>,
};

describe("Desktop Sidebar Toggle", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("renders toggle button on desktop viewport", () => {
    render(<Shell {...mockProps} />);
    const toggle = screen.getByRole("button", { name: /collapse sidebar|expand sidebar/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle.parentElement).toHaveClass("hidden");
    expect(toggle.parentElement).toHaveClass("md:flex");
  });

  it("shows aria-label 'Collapse sidebar' when sidebar is open by default", () => {
    render(<Shell {...mockProps} />);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toBeInTheDocument();
  });

  it("collapses sidebar and shows 'Expand sidebar' on click", () => {
    render(<Shell {...mockProps} />);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

    const sidebar = screen.getByRole("complementary");
    expect(sidebar.parentElement).toHaveClass("md:-translate-x-full");
    expect(sidebar.parentElement).not.toHaveClass("md:translate-x-0");
  });

  it("expands sidebar back on second click", () => {
    render(<Shell {...mockProps} />);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    fireEvent.click(toggle); // close
    fireEvent.click(toggle); // open

    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();

    const sidebar = screen.getByRole("complementary");
    expect(sidebar.parentElement).toHaveClass("md:translate-x-0");
    expect(sidebar.parentElement).not.toHaveClass("md:-translate-x-full");
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Shell } from "@/components/shell";

const mockPush = vi.fn();
let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
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

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe("Desktop Sidebar Toggle", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockPathname = "/";
    sessionStorage.clear();
    setViewportWidth(1024);
  });

  it("renders toggle button on desktop viewport", () => {
    render(<Shell {...mockProps} />);
    const toggle = screen.getByRole("button", { name: /collapse sidebar|expand sidebar/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveClass("hidden");
    expect(toggle).toHaveClass("md:flex");
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

  it("does not render the desktop sidebar toggle on settings routes", () => {
    mockPathname = "/settings/general";

    render(<Shell {...mockProps} />);

    expect(screen.getByTestId("settings-nav")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /collapse sidebar|expand sidebar/i })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-nav").parentElement).toHaveClass("md:translate-x-0");
  });

  it("opens the automations nav by default on direct desktop automations routes", () => {
    mockPathname = "/automations";

    render(<Shell {...mockProps} />);

    expect(screen.getByTestId("automations-nav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("automations-nav").parentElement).toHaveClass("md:translate-x-0");
  });

  it("keeps the chat sidebar collapsed after visiting desktop settings", () => {
    mockPathname = "/chat/conv_existing";
    const { rerender } = render(<Shell {...mockProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar").parentElement).toHaveClass("md:-translate-x-full");

    mockPathname = "/settings/general";
    rerender(<Shell {...mockProps} />);

    expect(screen.getByTestId("settings-nav")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav").parentElement).toHaveClass("md:translate-x-0");
    expect(
      screen.queryByRole("button", { name: /collapse sidebar|expand sidebar/i })
    ).not.toBeInTheDocument();

    mockPathname = "/chat/conv_existing";
    rerender(<Shell {...mockProps} />);

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar").parentElement).toHaveClass("md:-translate-x-full");
  });

  it("auto-hides the desktop sidebar once after home submits the first message", () => {
    mockPathname = "/chat/conv_new";
    sessionStorage.setItem("eidon:shell:auto-hide-sidebar-conversation", "conv_new");

    render(<Shell {...mockProps} />);

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar").parentElement).toHaveClass("md:-translate-x-full");
    expect(sessionStorage.getItem("eidon:shell:auto-hide-sidebar-conversation")).toBeNull();
  });

  it("keeps the home-submit auto-hide after StrictMode replays mount effects", () => {
    mockPathname = "/chat/conv_new";
    sessionStorage.setItem("eidon:shell:auto-hide-sidebar-conversation", "conv_new");

    render(
      <StrictMode>
        <Shell {...mockProps} />
      </StrictMode>
    );

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar").parentElement).toHaveClass("md:-translate-x-full");
    expect(sessionStorage.getItem("eidon:shell:auto-hide-sidebar-conversation")).toBeNull();
  });

  it("consumes the home-submit auto-hide marker on narrow viewports without leaving stale desktop state", () => {
    mockPathname = "/chat/conv_new";
    setViewportWidth(390);
    sessionStorage.setItem("eidon:shell:auto-hide-sidebar-conversation", "conv_new");

    const { unmount } = render(<Shell {...mockProps} />);

    expect(sessionStorage.getItem("eidon:shell:auto-hide-sidebar-conversation")).toBeNull();

    unmount();
    setViewportWidth(1024);
    render(<Shell {...mockProps} />);

    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar").parentElement).toHaveClass("md:translate-x-0");
  });
});

// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";

import { GeneralSection } from "@/components/settings/sections/general-section";
import { Shell } from "@/components/shell";
import type { AppSettings, AuthUser, ConversationListPage } from "@/lib/types";

type GeneralSectionSettings = AppSettings & {
  providerProfiles: Array<{ id: string; name: string; model: string }>;
};

const mockRefresh = vi.fn();
const mockPush = vi.fn();
let mockPathname = "/settings/general";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh
  })
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    )
  }
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: () => <aside data-testid="chat-sidebar">Chat sidebar</aside>
}));

vi.mock("@/components/settings/settings-nav", () => ({
  SettingsNav: () => <aside data-testid="settings-nav">Settings nav</aside>
}));

vi.mock("@/lib/ws-client", () => ({
  useGlobalWebSocket: vi.fn()
}));

vi.mock("@/lib/conversation-drafts", () => ({
  deleteConversationIfStillEmpty: vi.fn().mockResolvedValue(undefined)
}));

const settings: GeneralSectionSettings = {
  defaultProviderProfileId: "profile_default",
  skillsEnabled: true,
  conversationRetention: "forever",
  memoriesEnabled: true,
  memoriesMaxCount: 100,
  mcpTimeout: 120_000,
  maxAssistantToolSteps: 25,
  speechTranscription: {
    providerId: "browser",
    configuration: { language: "en" },
    configured: true,
    scope: "global"
  },
  webSearch: {
    providerId: "exa",
    configuration: {},
    configured: true,
    scope: "global"
  },
  imageGeneration: {
    providerId: "disabled",
    configuration: {},
    configured: true,
    scope: "global"
  },
  titleGenerationMode: "same",
  titleGenerationProfileId: null,
  providerProfiles: [
    { id: "profile_default", name: "Default", model: "gpt-test" }
  ],
  updatedAt: new Date().toISOString()
};

const conversationPage: ConversationListPage = {
  conversations: [],
  nextCursor: null,
  hasMore: false
};

const currentUser: AuthUser = {
  id: "user_admin",
  username: "admin",
  role: "admin",
  authSource: "env_super_admin",
  passwordManagedBy: "env",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("settings mobile layout", () => {
  beforeEach(() => {
    mockPathname = "/settings/general";
    mockRefresh.mockReset();
    mockPush.mockReset();
  });

  it("lets the general section use the full viewport width on mobile", () => {
    const { container } = render(React.createElement(GeneralSection, { settings }));

    expect(container.firstElementChild).toHaveClass("w-full");
    expect(container.firstElementChild).toHaveClass("max-w-none");
    expect(container.firstElementChild).toHaveClass("md:max-w-[55%]");
    expect(container.firstElementChild).not.toHaveClass("max-w-[55%]");
  });

  it("shows a settings-specific mobile header when browsing settings", () => {
    render(
      React.createElement(
        Shell,
        {
          currentUser,
          passwordLoginEnabled: true,
          conversationPage
        },
        React.createElement("div", null, "Settings content")
      )
    );

    expect(screen.getByRole("button", { name: "Open settings menu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Eidon")).not.toBeInTheDocument();
  });
});

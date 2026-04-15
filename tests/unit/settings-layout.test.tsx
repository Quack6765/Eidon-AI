// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";

import { GeneralSection } from "@/components/settings/sections/general-section";
import { SettingRow } from "@/components/settings/setting-row";
import { Shell } from "@/components/shell";
import type { AppSettings, AuthUser, ConversationListPage } from "@/lib/types";

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

const settings: AppSettings = {
  defaultProviderProfileId: "profile_default",
  skillsEnabled: true,
  conversationRetention: "forever",
  memoriesEnabled: true,
  memoriesMaxCount: 100,
  mcpTimeout: 120_000,
  sttEngine: "browser",
  sttLanguage: "en",
  webSearchEngine: "exa",
  exaApiKey: "",
  tavilyApiKey: "",
  searxngBaseUrl: "",
  imageGenerationBackend: "disabled",
  googleNanoBananaModel: "gemini-3.1-flash-image-preview",
  googleNanoBananaApiKey: "",
  comfyuiBaseUrl: "",
  comfyuiAuthType: "none",
  comfyuiBearerToken: "",
  comfyuiWorkflowJson: "",
  comfyuiPromptPath: "",
  comfyuiNegativePromptPath: "",
  comfyuiWidthPath: "",
  comfyuiHeightPath: "",
  comfyuiSeedPath: "",
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

  it("stacks setting rows vertically before the small breakpoint", () => {
    const { container } = render(
      <SettingRow
        label="Keep conversations for"
        description="Older conversations will be automatically deleted"
      >
        <select aria-label="Retention" />
      </SettingRow>
    );

    expect(container.firstElementChild).toHaveClass("flex-col");
    expect(container.firstElementChild).toHaveClass("items-start");
    expect(container.firstElementChild).toHaveClass("sm:flex-row");
    expect(container.firstElementChild).toHaveClass("sm:items-center");
    expect(container.firstElementChild).toHaveClass("sm:justify-between");
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
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Eidon")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { GeneralSection } from "@/components/settings/sections/general-section";
import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsAccordion } from "@/components/settings/settings-accordion";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
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
    credentialStored: false,
    scope: "global"
  },
  webSearch: {
    providerId: "exa",
    configuration: {},
    configured: true,
    credentialStored: false,
    scope: "global"
  },
  imageGeneration: {
    providerId: "disabled",
    configuration: {},
    configured: true,
    credentialStored: false,
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

  it("uses the full viewport for the general settings hierarchy", () => {
    const { container } = render(React.createElement(GeneralSection, { settings }));

    expect(container.firstElementChild).toHaveClass("w-full");
    expect(container.firstElementChild).toHaveClass("flex-1");
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversation Retention and history" })).toBeInTheDocument();
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
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.queryByText("Eidon")).not.toBeInTheDocument();
  });

  it("names each level of list-to-detail navigation", () => {
    const onBack = vi.fn();

    render(
      <SettingsSplitPane
        listHeader={<h2>Skills</h2>}
        listPanel={<div>Skill list</div>}
        detailPanel={<div>Editor</div>}
        isDetailVisible
        onBackAction={onBack}
        backLabel="Skills"
        detailTitle="Research assistant"
        detailFooter={<button type="button">Save</button>}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to Skills" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Research assistant")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("keeps accordions and list records keyboard-operable", () => {
    const onSelect = vi.fn();

    render(
      <>
        <SettingsAccordion title="Advanced configuration">
          <div>Advanced fields</div>
        </SettingsAccordion>
        <ProfileCard
          isActive={false}
          onClick={onSelect}
          title="Provider profile"
          subtitle="OpenAI compatible"
        />
      </>
    );

    const details = screen.getByText("Advanced configuration").closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Advanced configuration"));
    expect(details).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: /Provider profile/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

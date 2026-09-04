// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BotFormModal } from "@/components/agents/bot-form-modal";
import { toProviderProfileSummary } from "@/lib/provider-profile";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";
import type { BotSummary } from "@/lib/types";

const profiles = [
  toProviderProfileSummary(createRuntimeProviderProfile({ id: "profile_default", name: "Default", model: "gpt-a" })),
  toProviderProfileSummary(createRuntimeProviderProfile({ id: "profile_alt", name: "Alt", model: "gpt-b" }))
];

function buildBot(overrides: Partial<BotSummary> = {}): BotSummary {
  return {
    id: "bot_1",
    name: "Inbox Bot",
    title: "",
    description: "",
    avatarSeed: "seed",
    isChief: false,
    homeConversationId: "conv_1",
    providerProfileId: null,
    status: "idle",
    waitingForInput: false,
    lastRunAt: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    updatedAt: "2026-09-04T10:00:00.000Z",
    ...overrides
  };
}

function renderModal(bot: BotSummary, onSubmit: (values: unknown) => Promise<string | null>, withProfiles = true) {
  return render(
    React.createElement(BotFormModal, {
      open: true,
      onOpenChange: () => undefined,
      bot,
      currentSystemPrompt: "",
      submitLabel: "Save changes",
      title: "Edit bot",
      description: "Update the bot.",
      ...(withProfiles ? { providerProfiles: profiles, defaultProviderProfileId: "profile_default" } : {}),
      onSubmit
    })
  );
}

describe("bot form modal provider selection", () => {
  it("lists the configured providers with the default preselected and submits an explicit choice", async () => {
    const onSubmit = vi.fn(async () => null);
    renderModal(buildBot(), onSubmit);

    const select = screen.getByLabelText("Provider profile") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Default · Default · gpt-a" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alt · gpt-b" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "profile_alt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Inbox Bot", providerProfileId: "profile_alt" }));
    });
  });

  it("submits null when switching a pinned bot back to the default provider", async () => {
    const onSubmit = vi.fn(async () => null);
    renderModal(buildBot({ providerProfileId: "profile_alt" }), onSubmit);

    const select = screen.getByLabelText("Provider profile") as HTMLSelectElement;
    expect(select.value).toBe("profile_alt");

    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ providerProfileId: null }));
    });
  });

  it("hides the provider field when no profiles are supplied", () => {
    renderModal(buildBot(), vi.fn(async () => null), false);
    expect(screen.queryByLabelText("Provider profile")).toBeNull();
  });
});

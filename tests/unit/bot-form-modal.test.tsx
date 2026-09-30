// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BotFormModal } from "@/components/agents/bot-form-modal";
import {
  CHIEF_BOT_NAME,
  DEFAULT_CHIEF_DESCRIPTION,
  DEFAULT_CHIEF_SYSTEM_PROMPT
} from "@/lib/bot-defaults";
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
    unread: false,
    lastRunAt: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    updatedAt: "2026-09-04T10:00:00.000Z",
    ...overrides
  };
}

function renderModal(
  bot: BotSummary | null,
  onSubmit: (values: unknown) => Promise<string | null>,
  withProfiles = true,
  currentSystemPrompt = ""
) {
  return render(
    React.createElement(BotFormModal, {
      open: true,
      onOpenChange: () => undefined,
      bot,
      currentSystemPrompt,
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

describe("bot form modal reset default", () => {
  it("stages the chief's name, description, and system prompt back to the defaults without saving", async () => {
    const onSubmit = vi.fn(async () => null);
    renderModal(
      buildBot({ isChief: true, name: "Jarvis", title: "Right hand", description: "Custom duties." }),
      onSubmit,
      true,
      "Answer in French."
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset default" }));

    expect((screen.getByLabelText("Bot name") as HTMLInputElement).value).toBe(CHIEF_BOT_NAME);
    expect((screen.getByLabelText("Bot description") as HTMLTextAreaElement).value).toBe(DEFAULT_CHIEF_DESCRIPTION);
    expect((screen.getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe(DEFAULT_CHIEF_SYSTEM_PROMPT);
    expect((screen.getByLabelText("Bot title") as HTMLInputElement).value).toBe("Right hand");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText("Using the built-in default instructions.")).toBeNull();
  });

  it("saves the staged defaults through the normal submit path", async () => {
    const onSubmit = vi.fn(async () => null);
    renderModal(
      buildBot({ isChief: true, name: "Jarvis", description: "Custom duties." }),
      onSubmit,
      true,
      "Answer in French."
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset default" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: CHIEF_BOT_NAME,
          description: DEFAULT_CHIEF_DESCRIPTION,
          systemPrompt: DEFAULT_CHIEF_SYSTEM_PROMPT
        })
      );
    });
  });

  it("hints that a chief with no stored prompt is using the built-in default", () => {
    renderModal(buildBot({ isChief: true }), vi.fn(async () => null));
    expect(screen.getByText("Using the built-in default instructions.")).toBeInTheDocument();
  });

  it("hides the reset button for worker bots", () => {
    renderModal(buildBot(), vi.fn(async () => null));
    expect(screen.queryByRole("button", { name: "Reset default" })).toBeNull();
  });

  it("hides the reset button in the create modal", () => {
    renderModal(null, vi.fn(async () => null));
    expect(screen.queryByRole("button", { name: "Reset default" })).toBeNull();
  });
});

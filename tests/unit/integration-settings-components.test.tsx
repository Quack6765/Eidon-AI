// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { SpeechTranscriptionSettings } from "@/components/settings/integration-settings/speech-transcription-settings";
import { WebSearchSettings } from "@/components/settings/integration-settings/web-search-settings";
import type { CredentialAction } from "@/lib/integration-types";
import type { AppSettings } from "@/lib/types";

type WebSearchDraft = {
  providerId: AppSettings["webSearch"]["providerId"];
  configuration: AppSettings["webSearch"]["configuration"];
  credential: string;
  credentialAction: CredentialAction;
  credentialStored: boolean;
};

type SpeechDraft = {
  providerId: AppSettings["speechTranscription"]["providerId"];
  configuration: AppSettings["speechTranscription"]["configuration"];
  credential: string;
  credentialAction: CredentialAction;
  credentialStored: boolean;
};

const noop = () => undefined;

const cleanupDraft = {
  enabled: false,
  profileId: null as string | null,
  prompt: "Keep it clean."
};

describe("web search settings component", () => {
  it("disables every control and hides credentials for non-admins", () => {
    render(React.createElement(WebSearchSettings, {
      draft: {
        providerId: "searxng",
        configuration: { baseUrl: "https://search.example.com" },
        credential: "",
        credentialAction: "preserve",
        credentialStored: false
      } satisfies WebSearchDraft,
      persisted: {
        providerId: "searxng",
        configuration: { baseUrl: "https://search.example.com" },
        credential: "",
        credentialAction: "preserve",
        credentialStored: false
      } satisfies WebSearchDraft,
      canManage: false,
      dirty: false,
      onChange: noop
    }));

    expect(screen.getByText("Only admins can change web search settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Web search engine")).toBeDisabled();
    expect(screen.getByLabelText("SearXNG base URL")).toBeDisabled();
    expect(screen.getByLabelText("Search pipeline mode")).toBeDisabled();
    expect(screen.getByLabelText("Max parallel queries")).toBeDisabled();
  });

  it("hides the Tavily credential field for non-admins", () => {
    render(React.createElement(WebSearchSettings, {
      draft: {
        providerId: "tavily",
        configuration: {},
        credential: "",
        credentialAction: "preserve",
        credentialStored: true
      } satisfies WebSearchDraft,
      persisted: {
        providerId: "tavily",
        configuration: {},
        credential: "",
        credentialAction: "preserve",
        credentialStored: true
      } satisfies WebSearchDraft,
      canManage: false,
      dirty: false,
      onChange: noop
    }));

    expect(screen.getByText("Only admins can change web search settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Web search engine")).toBeDisabled();
    expect(screen.queryByLabelText("Tavily API key")).toBeNull();
  });

  it("keeps controls enabled and shows credentials for admins", () => {
    render(React.createElement(WebSearchSettings, {
      draft: {
        providerId: "tavily",
        configuration: {},
        credential: "",
        credentialAction: "preserve",
        credentialStored: true
      } satisfies WebSearchDraft,
      persisted: {
        providerId: "tavily",
        configuration: {},
        credential: "",
        credentialAction: "preserve",
        credentialStored: true
      } satisfies WebSearchDraft,
      canManage: true,
      dirty: false,
      onChange: noop
    }));

    expect(screen.getByText("Choose which web search engine is available to the agent.")).toBeInTheDocument();
    expect(screen.getByLabelText("Web search engine")).toBeEnabled();
    expect(screen.getByLabelText("Tavily API key")).toBeEnabled();
  });
});

describe("speech transcription settings component", () => {
  const externalDraft = {
    providerId: "elevenlabs",
    configuration: { language: "auto" },
    credential: "",
    credentialAction: "preserve",
    credentialStored: true
  } satisfies SpeechDraft;

  it("disables every control and hides credentials for non-admins", () => {
    render(React.createElement(SpeechTranscriptionSettings, {
      draft: externalDraft,
      persisted: externalDraft,
      canManage: false,
      dirty: false,
      onChange: noop,
      cleanup: cleanupDraft,
      cleanupDirty: false,
      providerProfiles: [],
      onCleanupChange: noop
    }));

    expect(screen.getByText("Only admins can change speech-to-text settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech engine")).toBeDisabled();
    expect(screen.getByLabelText("Speech-to-text provider")).toBeDisabled();
    expect(screen.getByLabelText("ElevenLabs transcription language")).toBeDisabled();
    expect(screen.queryByLabelText("ElevenLabs API key")).toBeNull();
    expect(screen.getByRole("checkbox", { name: /AI post-cleanup/ })).toBeDisabled();
  });

  it("keeps controls enabled and shows credentials for admins", () => {
    function StatefulSpeechSettings() {
      const [cleanup, setCleanup] = React.useState({ ...cleanupDraft });
      return React.createElement(SpeechTranscriptionSettings, {
        draft: externalDraft,
        persisted: externalDraft,
        canManage: true,
        dirty: false,
        onChange: noop,
        cleanup,
        cleanupDirty: false,
        providerProfiles: [{ id: "profile_a", name: "Anthropic", model: "claude-sonnet-4-5" }],
        onCleanupChange: setCleanup
      });
    }

    render(React.createElement(StatefulSpeechSettings));

    expect(screen.getByText("Choose where composer dictation is transcribed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech engine")).toBeEnabled();
    expect(screen.getByLabelText("Speech-to-text provider")).toBeEnabled();
    expect(screen.getByLabelText("ElevenLabs transcription language")).toBeEnabled();
    expect(screen.getByLabelText("ElevenLabs API key")).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /AI post-cleanup/ }));
    expect(screen.getByLabelText("Cleanup provider")).toHaveValue("profile_a");
    expect(screen.getByLabelText("Cleanup provider")).toBeEnabled();
    expect(screen.getByLabelText("Cleanup instructions")).toBeEnabled();
    expect(screen.getByRole("button", { name: /Restore default prompt/ })).toBeEnabled();
  });

  it("hints when AI post-cleanup is enabled without provider profiles", () => {
    render(React.createElement(SpeechTranscriptionSettings, {
      draft: externalDraft,
      persisted: externalDraft,
      canManage: true,
      dirty: false,
      onChange: noop,
      cleanup: { ...cleanupDraft, enabled: true },
      cleanupDirty: false,
      providerProfiles: [],
      onCleanupChange: noop
    }));

    expect(screen.getByText("Create a provider profile first.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cleanup provider")).toBeNull();
  });
});

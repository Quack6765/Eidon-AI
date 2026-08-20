// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";

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
      onChange: noop
    }));

    expect(screen.getByText("Only admins can change speech-to-text settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech engine")).toBeDisabled();
    expect(screen.getByLabelText("Speech-to-text provider")).toBeDisabled();
    expect(screen.getByLabelText("ElevenLabs transcription language")).toBeDisabled();
    expect(screen.queryByLabelText("ElevenLabs API key")).toBeNull();
  });

  it("keeps controls enabled and shows credentials for admins", () => {
    render(React.createElement(SpeechTranscriptionSettings, {
      draft: externalDraft,
      persisted: externalDraft,
      canManage: true,
      dirty: false,
      onChange: noop
    }));

    expect(screen.getByText("Choose where composer dictation is transcribed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech engine")).toBeEnabled();
    expect(screen.getByLabelText("Speech-to-text provider")).toBeEnabled();
    expect(screen.getByLabelText("ElevenLabs transcription language")).toBeEnabled();
    expect(screen.getByLabelText("ElevenLabs API key")).toBeEnabled();
  });
});

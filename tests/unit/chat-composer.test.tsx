// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ChatComposer } from "@/components/chat-composer";
import type { SpeechPhase } from "@/lib/speech/types";

const originalMatchMedia = window.matchMedia;

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia
  });
});

function renderComposer(overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const textareaRef = React.createRef<HTMLTextAreaElement>();
  const props: React.ComponentProps<typeof ChatComposer> = {
    input: "",
    onInputChange: vi.fn(),
    onSubmit: vi.fn(),
    isSending: false,
    pendingAttachments: [],
    isUploadingAttachments: false,
    onUploadFiles: vi.fn(),
    onRemovePendingAttachment: vi.fn(),
    showVisionWarning: false,
    providerProfiles: [],
    providerProfileId: "",
    onProviderProfileChange: vi.fn(),
    personas: [],
    personaId: null,
    onPersonaChange: vi.fn(),
    textareaRef,
    usedTokens: null,
    modelContextLimit: 128000,
    compactionLimit: 100000,
    hasMessages: false,
    canStop: false,
    isStopPending: false,
    onStop: vi.fn(),
    speechPhase: "idle" as SpeechPhase,
    speechLevel: 0,
    speechError: null,
    onStartSpeech: vi.fn(),
    onStopSpeech: vi.fn(),
    ...overrides
  };
  render(<ChatComposer {...props} />);
  return { textareaRef };
}

describe("ChatComposer collapsible toolbar", () => {
  it("shows the toolbar when the feature is disabled (home view), even on mobile", () => {
    installMatchMedia(true);
    renderComposer({ collapsibleToolbarOnMobile: false });
    expect(screen.getByLabelText("Attach files")).toBeInTheDocument();
  });

  it("shows the toolbar on desktop when the feature is enabled", () => {
    installMatchMedia(false);
    renderComposer({ collapsibleToolbarOnMobile: true });
    expect(screen.getByLabelText("Attach files")).toBeInTheDocument();
  });

  it("hides the toolbar at rest on mobile and reveals it on input focus", async () => {
    installMatchMedia(true);
    const { textareaRef } = renderComposer({ collapsibleToolbarOnMobile: true });

    expect(screen.queryByLabelText("Attach files")).toBeNull();

    act(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) fireEvent.focus(textareaRef.current);
    });

    expect(await screen.findByLabelText("Attach files")).toBeInTheDocument();
  });
});

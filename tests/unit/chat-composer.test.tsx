// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { ChatComposer } from "@/components/chat-composer";
import { toProviderProfileSummary } from "@/lib/provider-profile";
import type { SpeechPhase } from "@/lib/speech/types";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

function createMockClipboardData(initialFiles: File[] = []) {
  const storedFiles: File[] = [...initialFiles];
  const dataMap = new Map<string, string>();

  return {
    get files(): FileList {
      const list = Object.create(FileList.prototype) as Record<number, File>;
      for (let i = 0; i < storedFiles.length; i++) list[i] = storedFiles[i];
      Object.defineProperty(list, "length", { value: storedFiles.length });
      return list as unknown as FileList;
    },
    items: {
      add(file: File | string) {
        if (file instanceof File) storedFiles.push(file);
      },
      length: storedFiles.length,
      clear() {},
      remove() {}
    },
    setData(format: string, value: string) {
      dataMap.set(format, value);
    },
    getData(format: string) {
      return dataMap.get(format) ?? "";
    }
  } as unknown as DataTransfer;
}

class MockClipboardEvent extends Event {
  clipboardData: DataTransfer;

  constructor(type: string, init?: EventInit & { clipboardData?: DataTransfer }) {
    super(type, init);
    this.clipboardData = init?.clipboardData ?? createMockClipboardData();
  }
}

Object.defineProperty(window, "ClipboardEvent", {
  configurable: true,
  writable: true,
  value: MockClipboardEvent
});

Object.defineProperty(window, "DataTransfer", {
  configurable: true,
  writable: true,
  value: createMockClipboardData
});

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
    reasoningEffort: null,
    onReasoningEffortChange: vi.fn(),
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
  const view = render(<ChatComposer {...props} />);
  return {
    textareaRef,
    rerenderComposer: (nextOverrides: Partial<React.ComponentProps<typeof ChatComposer>>) => {
      view.rerender(<ChatComposer {...props} {...nextOverrides} />);
    }
  };
}

describe("ChatComposer responsive controls", () => {
  it("matches the native composer placeholder in idle and queueing states", () => {
    const { rerenderComposer } = renderComposer();

    expect(screen.getByPlaceholderText("Message Eidon")).toBeInTheDocument();

    rerenderComposer({ queueingEnabled: true });

    expect(screen.getByPlaceholderText("Queue a message")).toBeInTheDocument();
  });

  it("keeps the text entry surface visually distinct from the composer shell", () => {
    renderComposer();

    expect(screen.getByRole("textbox")).toHaveClass(
      "border-white/[0.06]",
      "bg-white/[0.03]",
      "min-h-11",
      "placeholder:text-center",
      "placeholder:text-white/30",
      "focus:border-[var(--accent)]/30",
      "focus:bg-white/[0.05]"
    );
  });

  it("shows the toolbar when the feature is disabled (home view), even on mobile", () => {
    installMatchMedia(true);
    renderComposer({ compactOnMobile: false });
    expect(screen.getByLabelText("Attach files")).toBeInTheDocument();
  });

  it("shows the toolbar on desktop when the feature is enabled", () => {
    installMatchMedia(false);
    renderComposer({ compactOnMobile: true });
    expect(screen.getByLabelText("Attach files")).toBeInTheDocument();
  });

  it("uses a compact tools menu on mobile instead of revealing the toolbar on focus", async () => {
    installMatchMedia(true);
    const { textareaRef } = renderComposer({ compactOnMobile: true });

    expect(screen.queryByLabelText("Attach files")).toBeNull();
    expect(screen.getByRole("button", { name: "Open composer tools" })).toBeInTheDocument();

    act(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) fireEvent.focus(textareaRef.current);
    });

    expect(screen.queryByLabelText("Attach files")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open composer tools" }));

    expect(await screen.findByRole("dialog", { name: "Composer tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close composer tools" })).toHaveAttribute("aria-expanded", "true");
  });

  it("moves wrapped text above a spacious bottom action row on mobile", () => {
    installMatchMedia(true);
    const { textareaRef, rerenderComposer } = renderComposer({ compactOnMobile: true });
    const textarea = textareaRef.current!;
    let measuredHeight = 88;

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => measuredHeight
    });

    rerenderComposer({
      compactOnMobile: true,
      input: "A long mobile draft that wraps onto a second line in the composer."
    });

    const composerLayout = textarea.parentElement?.parentElement;
    const toolsControl = screen.getByRole("button", { name: "Open composer tools" }).parentElement;
    const actionRow = screen.getByRole("button", { name: "Send message" }).parentElement;

    expect(composerLayout).toHaveClass("grid-rows-[auto_auto]", "gap-x-2", "gap-y-1.5");
    expect(textarea.parentElement).toHaveClass("col-span-3", "row-start-1");
    expect(toolsControl).toHaveClass("col-start-1", "row-start-2");
    expect(actionRow).toHaveClass("col-start-3", "row-start-2", "gap-2");

    measuredHeight = 40;
    rerenderComposer({
      compactOnMobile: true,
      input: "A long mobile draft that now fits after the textarea becomes wider."
    });

    expect(composerLayout).toHaveClass("grid-rows-[auto_auto]");
    expect(textarea.parentElement).toHaveClass("col-span-3", "row-start-1");

    rerenderComposer({ compactOnMobile: true, input: "" });

    expect(composerLayout).not.toHaveClass("grid-rows-[auto_auto]");
  });

  it("keeps desktop tools and actions on one bottom rail below the text input", () => {
    installMatchMedia(false);
    const { textareaRef } = renderComposer({
      compactOnMobile: true,
      input: "A desktop draft stays above every composer control."
    });
    const textarea = textareaRef.current!;
    const composerLayout = textarea.parentElement?.parentElement;
    const actionRow = screen.getByRole("button", { name: "Send message" }).parentElement;
    const toolbar = screen.getByRole("button", { name: "Attach files" }).closest("[style]");

    expect(composerLayout).toHaveClass(
      "md:grid-cols-[minmax(0,1fr)_auto]",
      "md:gap-x-3"
    );
    expect(textarea.parentElement).toHaveClass(
      "md:col-span-2",
      "md:col-start-1",
      "md:row-start-1"
    );
    expect(actionRow).toHaveClass("md:col-start-2", "md:row-start-2", "gap-2");
    expect(toolbar).toHaveClass("md:col-start-1", "md:row-start-2");
  });

  it("keeps speech errors separated from the composer controls", () => {
    renderComposer({ speechError: "Selected speech engine is unavailable." });

    expect(screen.getByText("Selected speech engine is unavailable.")).toHaveClass("mt-2");
  });

  it("keeps temporary mode exposed above the composer on mobile", () => {
    installMatchMedia(true);
    const onTemporaryChange = vi.fn();

    const { rerenderComposer } = renderComposer({
      compactOnMobile: true,
      showTemporaryToggle: true,
      onTemporaryChange
    });

    const temporaryToggle = screen.getByRole("button", { name: "Temporary conversation" });
    expect(temporaryToggle.parentElement).toHaveClass("-top-[31px]", "flex", "h-8");
    expect(temporaryToggle).toHaveClass(
      "gap-1",
      "border-b-0",
      "group-focus-within/composer:border-[var(--accent)]/30"
    );
    expect(temporaryToggle).toHaveStyle({ fontSize: "11px" });
    expect(temporaryToggle.querySelector("svg")).toHaveClass("h-3", "w-3");

    fireEvent.click(temporaryToggle);

    expect(onTemporaryChange).toHaveBeenCalledWith(true);

    rerenderComposer({
      compactOnMobile: true,
      showTemporaryToggle: true,
      onTemporaryChange,
      isTemporary: true
    });

    expect(screen.getByRole("button", { name: "Temporary conversation" })).toHaveClass(
      "border-dashed",
      "border-b-0"
    );
  });

  it("offers a deep research button beside the reasoning effort control", () => {
    const onResearchChange = vi.fn();

    const { rerenderComposer } = renderComposer({ onResearchChange });

    const researchButton = screen.getByRole("button", { name: "Deep research" });
    expect(researchButton).toHaveAttribute("aria-pressed", "false");
    expect(researchButton.parentElement).toBe(
      screen.getByRole("button", { name: "Reasoning effort" }).parentElement?.parentElement
    );

    fireEvent.click(researchButton);
    expect(onResearchChange).toHaveBeenCalledWith(true);

    rerenderComposer({ onResearchChange, isResearch: true });
    expect(screen.getByRole("button", { name: "Deep research" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Deep research" })).toHaveClass("text-[var(--accent)]");

    rerenderComposer({ onResearchChange, isResearch: true, isSending: true });
    expect(screen.getByRole("button", { name: "Deep research" })).toBeDisabled();
  });

  it("hides the deep research button when no handler is provided", () => {
    renderComposer();

    expect(screen.queryByRole("button", { name: "Deep research" })).toBeNull();
  });

  it("exposes deep research in the mobile tools menu", async () => {
    installMatchMedia(true);
    const onResearchChange = vi.fn();

    renderComposer({ compactOnMobile: true, onResearchChange, isResearch: true });

    fireEvent.click(screen.getByRole("button", { name: "Open composer tools" }));

    const researchRow = await screen.findByRole("button", { name: "Deep research" });
    expect(researchRow).toHaveAttribute("aria-pressed", "true");
    expect(researchRow).toHaveTextContent("On for the next message");

    fireEvent.click(researchRow);
    expect(onResearchChange).toHaveBeenCalledWith(false);
  });

  it("keeps model, persona, and context usage available in the mobile menu", async () => {
    installMatchMedia(true);
    const onProviderProfileChange = vi.fn();
    const onPersonaChange = vi.fn();
    const providerProfile = toProviderProfileSummary(createRuntimeProviderProfile({
      id: "profile_1",
      name: "Daily model",
      model: "gpt-5-mini"
    }));

    renderComposer({
      compactOnMobile: true,
      providerProfiles: [providerProfile],
      providerProfileId: providerProfile.id,
      onProviderProfileChange,
      personas: [{ id: "persona_1", name: "Editor" }],
      personaId: "persona_1",
      onPersonaChange,
      hasMessages: true,
      usedTokens: 1200
    });

    fireEvent.click(screen.getByRole("button", { name: "Open composer tools" }));

    expect(screen.getByText("Daily model")).toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.getByText("Context usage")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Daily model"));
    fireEvent.click(screen.getByRole("button", { name: /Daily model/ }));

    expect(onProviderProfileChange).toHaveBeenCalledWith("profile_1");
  });

  it("shows separate stop and queue actions when drafting during an active response", () => {
    installMatchMedia(true);
    renderComposer({
      compactOnMobile: true,
      input: "One more thing",
      isSending: true,
      canStop: true,
      queueingEnabled: true
    });

    expect(screen.getByRole("button", { name: "Stop response" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue follow-up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start voice input" })).toBeNull();
  });
});

describe("ChatComposer reasoning effort selector", () => {
  const providerProfile = toProviderProfileSummary(createRuntimeProviderProfile({
    id: "profile_effort",
    name: "Daily model",
    model: "gpt-5-mini"
  }));

  it("lists the provider's effort options with the default badged and the effective level highlighted", async () => {
    installMatchMedia(false);
    const onReasoningEffortChange = vi.fn();

    renderComposer({
      providerProfiles: [providerProfile],
      providerProfileId: providerProfile.id,
      reasoningEffort: "high",
      onReasoningEffortChange
    });

    const trigger = screen.getByRole("button", { name: "Reasoning effort" });
    expect(trigger).toHaveTextContent("High");

    fireEvent.click(trigger);

    const popover = document.querySelector("div.absolute.bottom-full") as HTMLElement;
    const optionLabels = within(popover)
      .getAllByText(/^(Disabled|Low|Medium|High|Xhigh)$/)
      .map((option) => option.textContent);
    expect(optionLabels).toEqual(["Disabled", "Low", "Medium", "High", "Xhigh"]);

    const mediumRow = within(popover).getByText("Medium").closest("button")!;
    expect(mediumRow).toHaveTextContent("Default");

    const highRow = within(popover).getByText("High").closest("button")!;
    expect(highRow).toHaveClass("bg-white/10");

    fireEvent.click(within(popover).getByText("Xhigh"));

    expect(onReasoningEffortChange).toHaveBeenCalledWith("xhigh");
  });

  it("shows the provider default as selected when no conversation effort is stored", async () => {
    installMatchMedia(false);

    renderComposer({
      providerProfiles: [providerProfile],
      providerProfileId: providerProfile.id,
      reasoningEffort: null
    });

    const effortButton = screen.getByRole("button", { name: "Reasoning effort" });
    expect(effortButton).toHaveTextContent("Medium");
  });

  it("falls back to the provider default when the stored effort is unsupported", () => {
    installMatchMedia(false);

    renderComposer({
      providerProfiles: [providerProfile],
      providerProfileId: providerProfile.id,
      reasoningEffort: "max"
    });

    expect(screen.getByRole("button", { name: "Reasoning effort" })).toHaveTextContent("Medium");
  });

  it("keeps the effort control disabled without a provider profile", () => {
    installMatchMedia(false);

    renderComposer({ providerProfiles: [], providerProfileId: "" });

    expect(screen.getByRole("button", { name: "Reasoning effort" })).toBeDisabled();
  });

  it("offers effort selection from the mobile tools sheet", async () => {
    installMatchMedia(true);
    const onReasoningEffortChange = vi.fn();

    renderComposer({
      compactOnMobile: true,
      providerProfiles: [providerProfile],
      providerProfileId: providerProfile.id,
      reasoningEffort: "low",
      onReasoningEffortChange
    });

    fireEvent.click(screen.getByRole("button", { name: "Open composer tools" }));

    const effortRow = screen.getByRole("button", { name: /Effort/ });
    expect(effortRow).toHaveTextContent("Low");

    fireEvent.click(effortRow);

    expect(screen.getByRole("button", { name: /^Effort$/ })).toBeInTheDocument();
    const highRow = screen.getByText("High").closest("button")!;
    expect(highRow).not.toHaveTextContent("Default");
    expect(screen.getByText("Medium").closest("button")).toHaveTextContent("Default");

    fireEvent.click(screen.getByText("High"));

    expect(onReasoningEffortChange).toHaveBeenCalledWith("high");
  });
});

describe("ChatComposer clipboard image paste", () => {
  it("calls onUploadFiles when an image is pasted from clipboard", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const imageFile = new File(["fake-image-bytes"], "screenshot.png", { type: "image/png" });
    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.items.add(imageFile);

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).toHaveBeenCalledOnce();
    expect(onUploadFiles).toHaveBeenCalledWith([imageFile]);
    expect(clipboardEvent.defaultPrevented).toBe(true);
  });

  it("does not call onUploadFiles when text is pasted", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.setData("text/plain", "hello");

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).not.toHaveBeenCalled();
    expect(clipboardEvent.defaultPrevented).toBe(false);
  });

  it("does not call onUploadFiles when non-image files are pasted", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.items.add(textFile);

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).not.toHaveBeenCalled();
    expect(clipboardEvent.defaultPrevented).toBe(false);
  });

  it("filters to only image files when mixed content is pasted", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const imageFile = new File(["fake-image-bytes"], "photo.jpg", { type: "image/jpeg" });
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.items.add(imageFile);
    clipboardEvent.clipboardData!.items.add(textFile);

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).toHaveBeenCalledOnce();
    expect(onUploadFiles).toHaveBeenCalledWith([imageFile]);
    expect(clipboardEvent.defaultPrevented).toBe(true);
  });
});

describe("ChatComposer speech progress", () => {
  it("shows an announced indeterminate status while transcription is processing", () => {
    renderComposer({ speechPhase: "transcribing" });

    expect(screen.getByRole("status")).toHaveTextContent("Transcribing…");
    expect(screen.queryByRole("button", { name: "Stop voice input" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});

describe("ChatComposer Enter key submission", () => {
  it("submits on Enter on a desktop viewport", () => {
    installMatchMedia(false);
    const onSubmit = vi.fn();
    renderComposer({ input: "hello", onSubmit });

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not submit on Enter on a mobile viewport (line break instead)", () => {
    installMatchMedia(true);
    const onSubmit = vi.fn();
    renderComposer({ input: "hello", onSubmit });

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

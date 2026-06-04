// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ChatComposer } from "@/components/chat-composer";
import type { SpeechPhase } from "@/lib/speech/types";

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

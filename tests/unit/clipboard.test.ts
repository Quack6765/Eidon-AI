// @vitest-environment jsdom

import { writeRichTextToClipboard, writeTextToClipboard } from "@/lib/clipboard";

describe("clipboard helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers the synchronous legacy copy path on iPhone-class devices", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      configurable: true
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 5,
      configurable: true
    });

    await writeTextToClipboard("print('hello')");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses navigator.clipboard.writeText on non-iPhone browsers", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 0,
      configurable: true
    });

    await writeTextToClipboard("print('hello')");

    expect(writeText).toHaveBeenCalledWith("print('hello')");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to the legacy path when writeText rejects on non-iPhone browsers", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 0,
      configurable: true
    });

    await writeTextToClipboard("print('hello')");

    expect(writeText).toHaveBeenCalledWith("print('hello')");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("uses rich clipboard writes when html copy is available on non-iPhone browsers", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const write = vi.fn().mockResolvedValue(undefined);

    class MockClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { write, writeText: vi.fn() },
      configurable: true
    });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 0,
      configurable: true
    });
    vi.stubGlobal("ClipboardItem", MockClipboardItem as unknown as typeof ClipboardItem);

    await writeRichTextToClipboard({
      html: "<p>Hello</p>",
      text: "Hello"
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("uses plain writeText when rich clipboard writes are unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      configurable: true
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 0,
      configurable: true
    });
    vi.stubGlobal("ClipboardItem", undefined);

    await writeRichTextToClipboard({
      html: "",
      text: "Hello"
    });

    expect(writeText).toHaveBeenCalledWith("Hello");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("keeps rich clipboard writes enabled for iPhone-class devices when available", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const write = vi.fn().mockResolvedValue(undefined);

    class MockClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { write, writeText: vi.fn() },
      configurable: true
    });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      configurable: true
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 5,
      configurable: true
    });
    vi.stubGlobal("ClipboardItem", MockClipboardItem as unknown as typeof ClipboardItem);

    await writeRichTextToClipboard({
      html: "<p>Hello</p>",
      text: "Hello"
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(execCommand).not.toHaveBeenCalled();
  });
});

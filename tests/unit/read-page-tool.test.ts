import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
import { executeToolCall } from "@/lib/tool-executors";
import type { ToolSet } from "@/lib/tool-definitions";
import type { PromptMessage, RuntimeAppSettings, RuntimeProviderProfile, Skill } from "@/lib/types";
import { createRuntimeAppSettings, createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const { readWebPageMock } = vi.hoisted(() => ({ readWebPageMock: vi.fn() }));

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: vi.fn(),
  callProviderText: vi.fn()
}));

vi.mock("@/lib/web-read", () => ({
  readWebPage: readWebPageMock
}));

describe("read_page tool executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readWebPageMock.mockResolvedValue("# Example\nSource: https://example.com/\n\nBody text");
  });

  function makeContext(appSettings: RuntimeAppSettings | undefined = createRuntimeAppSettings()) {
    const onActionStart = vi.fn().mockResolvedValue("act_1");
    const onActionComplete = vi.fn();
    const onActionError = vi.fn();
    const abortController = new AbortController();
    const context = {
      input: {
        settings: createRuntimeProviderProfile(),
        appSettings,
        skills: [] as Skill[],
        mcpToolSets: [] as ToolSet[],
        abortSignal: abortController.signal,
        onActionStart,
        onActionComplete,
        onActionError
      } as {
        settings: RuntimeProviderProfile;
        appSettings?: RuntimeAppSettings;
        skills: Skill[];
        mcpToolSets: ToolSet[];
        abortSignal: AbortSignal;
        onActionStart: typeof onActionStart;
        onActionComplete: typeof onActionComplete;
        onActionError: typeof onActionError;
      },
      timelineSortOrder: 3,
      promptMessages: [{ role: "user" as const, content: "Read this page" }] as PromptMessage[]
    };
    return { context, onActionStart, onActionComplete, onActionError, abortController };
  }

  async function callReadPage(args: Record<string, unknown>, context: ReturnType<typeof makeContext>["context"]) {
    return executeToolCall(
      { id: "call_1", name: "read_page", arguments: JSON.stringify(args) },
      {
        input: context.input,
        mcpServers: [],
        loadedSkillIds: new Set(),
        successfulReadOnlyToolResults: new Map(),
        timelineSortOrder: context.timelineSortOrder,
        promptMessages: context.promptMessages
      }
    );
  }

  it("emits one action and returns the page as the tool result", async () => {
    const { context, onActionStart, onActionComplete, onActionError } = makeContext();

    const result = await callReadPage({ url: "https://example.com/ " }, context);

    expect(readWebPageMock).toHaveBeenCalledWith({
      url: "https://example.com/",
      maxChars: undefined,
      settings: context.input.appSettings,
      abortSignal: context.input.abortSignal
    });
    expect(onActionStart).toHaveBeenCalledWith({
      kind: "mcp_tool_call",
      label: "Read page",
      detail: "https://example.com/",
      serverId: "integration_web_search",
      toolName: "read_page",
      arguments: { url: "https://example.com/" }
    });
    expect(onActionComplete).toHaveBeenCalledWith("act_1", {
      detail: "https://example.com/",
      resultSummary: "Example (49 chars)"
    });
    expect(onActionError).not.toHaveBeenCalled();
    expect(result.nextSortOrder).toBe(4);
    expect(result.toolSucceeded).toBe(true);
    expect(result.promptMessages.at(-1)).toMatchObject({
      role: "tool",
      content: "# Example\nSource: https://example.com/\n\nBody text"
    });
  });

  it("forwards max_chars and summarizes untitled pages", async () => {
    readWebPageMock.mockResolvedValue("Source: https://example.com/notes.txt\n\nplain");
    const { context, onActionStart, onActionComplete } = makeContext();
    context.input.appSettings = undefined;

    await callReadPage({ url: "https://example.com/notes.txt", max_chars: 2000 }, context);

    expect(readWebPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxChars: 2000, settings: undefined })
    );
    expect(onActionStart).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: { url: "https://example.com/notes.txt", max_chars: 2000 } })
    );
    expect(onActionComplete).toHaveBeenCalledWith("act_1", expect.objectContaining({ resultSummary: "Page (44 chars)" }));
  });

  it("rejects a missing url without starting an action", async () => {
    const { context, onActionStart } = makeContext();

    const result = await callReadPage({}, context);

    expect(readWebPageMock).not.toHaveBeenCalled();
    expect(onActionStart).not.toHaveBeenCalled();
    expect(result.toolSucceeded).toBe(false);
    expect(result.nextSortOrder).toBe(3);
    expect(result.promptMessages.at(-1)).toMatchObject({ content: "Error: url is required" });
  });

  it("marks the action as failed when the read fails", async () => {
    readWebPageMock.mockRejectedValue(new Error("Page request failed with status 404"));
    const { context, onActionError, onActionComplete } = makeContext();

    const result = await callReadPage({ url: "https://example.com/missing" }, context);

    expect(onActionError).toHaveBeenCalledWith("act_1", {
      detail: "https://example.com/missing",
      resultSummary: "Page request failed with status 404"
    });
    expect(onActionComplete).not.toHaveBeenCalled();
    expect(result.toolSucceeded).toBe(false);
    expect(result.promptMessages.at(-1)).toMatchObject({
      content: "Error: Page request failed with status 404"
    });

    readWebPageMock.mockRejectedValue("boom");
    const fallback = await callReadPage({ url: "https://example.com/missing" }, context);
    expect(fallback.promptMessages.at(-1)).toMatchObject({ content: "Error: Page could not be read" });
  });

  it("propagates a stop request instead of reporting an error", async () => {
    const { context, abortController, onActionError } = makeContext();
    readWebPageMock.mockImplementation(async () => {
      abortController.abort();
      throw new Error("aborted");
    });

    await expect(callReadPage({ url: "https://example.com/" }, context)).rejects.toBeInstanceOf(ChatTurnStoppedError);
    expect(onActionError).not.toHaveBeenCalled();
  });
});

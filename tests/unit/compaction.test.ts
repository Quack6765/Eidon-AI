import {
  buildPromptMessages,
  ensureCompactedContext,
  getConversationDebugStats
} from "@/lib/compaction";
import { createConversation, createMessage, listMessages } from "@/lib/conversations";
import { getDefaultProviderProfileWithApiKey, updateSettings } from "@/lib/settings";

vi.mock("@/lib/provider", async () => {
  return {
    callProviderText: vi.fn(async (input: { prompt: string }) => {
      const ids = [...input.prompt.matchAll(/msg_[a-z0-9-]+/gi)].map((match) => match[0]);

      return JSON.stringify({
        factualCommitments: ["fact"],
        userPreferences: ["preference"],
        unresolvedItems: ["todo"],
        importantReferences: ["reference"],
        chronology: ["chronology"],
        sourceSpan: {
          startMessageId: ids[0] ?? "msg_start",
          endMessageId: ids.at(-1) ?? "msg_end",
          messageCount: Math.max(ids.length, 1)
        }
      });
    })
  };
});

describe("lossless compaction", () => {
  function updateDefaultProfile(overrides: Partial<{
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    apiMode: "responses" | "chat_completions";
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
    reasoningSummaryEnabled: boolean;
    modelContextLimit: number;
    compactionThreshold: number;
    freshTailCount: number;
  }>) {
    updateSettings({
      defaultProviderProfileId: "profile_default",
      providerProfiles: [
        {
          id: "profile_default",
          name: "Default",
          apiBaseUrl: overrides.apiBaseUrl ?? "https://api.example.com/v1",
          apiKey: overrides.apiKey ?? "sk-test",
          model: overrides.model ?? "gpt-test",
          apiMode: overrides.apiMode ?? "responses",
          systemPrompt: overrides.systemPrompt ?? "Preserve context exactly.",
          temperature: overrides.temperature ?? 0.2,
          maxOutputTokens: overrides.maxOutputTokens ?? 256,
          reasoningEffort: overrides.reasoningEffort ?? "medium",
          reasoningSummaryEnabled: overrides.reasoningSummaryEnabled ?? true,
          modelContextLimit: overrides.modelContextLimit ?? 16000,
          compactionThreshold: overrides.compactionThreshold ?? 0.8,
          freshTailCount: overrides.freshTailCount ?? 8
        }
      ]
    });
  }

  it("builds prompts from compacted memory plus recent raw turns", () => {
    const prompt = buildPromptMessages({
      systemPrompt: "Stay concise.",
      activeMemoryNodes: [
        {
          id: "mem_1",
          conversationId: "conv_1",
          type: "leaf_summary",
          depth: 0,
          content: "{\"factualCommitments\":[\"A\"]}",
          sourceStartMessageId: "msg_1",
          sourceEndMessageId: "msg_4",
          sourceTokenCount: 120,
          summaryTokenCount: 22,
          childNodeIds: [],
          supersededByNodeId: null,
          createdAt: new Date().toISOString()
        }
      ],
      messages: [
        {
          id: "msg_5",
          conversationId: "conv_1",
          role: "user",
          content: "What next?",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 3,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        }
      ],
      userInput: "Append this"
    });

    expect(prompt[0].content).toContain("Stay concise.");
    expect(prompt[1].content).toContain("Compacted conversation memory");
    expect(prompt.at(-1)?.content).toBe("Append this");
  });

  it("compacts older turns when the token threshold is exceeded", async () => {
    updateDefaultProfile({
      modelContextLimit: 6000,
      compactionThreshold: 0.7
    });

    const conversation = createConversation();

    for (let index = 0; index < 18; index += 1) {
      createMessage({
        conversationId: conversation.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index} ${"dense context ".repeat(90)}`,
        thinkingContent: index % 2 === 1 ? "Reasoning " + "step ".repeat(24) : ""
      });
    }

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const stats = getConversationDebugStats(conversation.id);
    const messages = listMessages(conversation.id);

    expect(result.compactionNoticeEvent?.type).toBe("system_notice");
    expect(stats.memoryNodeCount).toBeGreaterThan(0);
    expect(messages.some((message) => message.compactedAt)).toBe(true);
    expect(
      result.promptMessages.some((message) =>
        message.content.includes("Compacted conversation memory")
      )
    ).toBe(true);
  });

  it("returns compacted context without compaction when the conversation fits and errors on missing conversations", async () => {
    updateDefaultProfile({});

    const conversation = createConversation();
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Short message"
    });

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );

    expect(result.compactionNoticeEvent).toBeNull();
    await expect(
      ensureCompactedContext("missing", getDefaultProviderProfileWithApiKey()!)
    ).rejects.toThrow("Conversation not found");
  });

  it("fails cleanly when the prompt is too large and nothing is eligible for compaction", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      compactionThreshold: 0.7
    });

    const conversation = createConversation();

    for (let index = 0; index < 8; index += 1) {
      createMessage({
        conversationId: conversation.id,
        role: "user",
        content: `Huge ${"context ".repeat(400)} ${index}`
      });
    }

    await expect(
      ensureCompactedContext(conversation.id, getDefaultProviderProfileWithApiKey()!)
    ).rejects.toThrow(
      "Conversation exceeds the configured context limit even after compaction."
    );
  });
});

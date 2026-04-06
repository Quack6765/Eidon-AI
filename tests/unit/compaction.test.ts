import {
  buildPromptMessages,
  ensureCompactedContext,
  getConversationDebugStats
} from "@/lib/compaction";
import { createConversation, createMessage, listMessages } from "@/lib/conversations";
import { getDefaultProviderProfileWithApiKey, updateSettings } from "@/lib/settings";
import type { PromptMessage } from "@/lib/types";

vi.mock("@/lib/provider", async () => {
  return {
    callProviderText: vi.fn(async (input: { prompt: string }) => {
      const ids = [...input.prompt.matchAll(/msg_[a-z0-9-]+/gi)].map((match) => match[0]);

      return `- Fact from messages: users discussed context compaction
- Preference: keep last ${ids.length} messages fresh
- Unresolved: need to test NL summaries
- Reference: compaction system modules
- Chronology: started at ${ids[0] ?? "msg_start"}, ended at ${ids.at(-1) ?? "msg_end"}`;
    })
  };
});

describe("lossless compaction", () => {
  function getPromptText(message: Pick<PromptMessage, "content">) {
    return typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  }

  function updateDefaultProfile(
    overrides: Partial<{
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
    }>
  ) {
    updateSettings({
      defaultProviderProfileId: "profile_default",
      skillsEnabled: true,
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
          content: "- Fact: user prefers dark mode\n- Preference: keep responses short",
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

    expect(getPromptText(prompt[0]!)).toContain("Stay concise.");
    expect(getPromptText(prompt[0]!)).toContain("Compacted Memory");
    expect(getPromptText(prompt.at(-1)!)).toBe("Append this");
  });

  it("merges system messages into single system prompt", () => {
    const prompt = buildPromptMessages({
      systemPrompt: "Primary system prompt.",
      activeMemoryNodes: [],
      messages: [
        {
          id: "msg_hidden",
          conversationId: "conv_1",
          role: "system",
          content: "Legacy stored system prompt.",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "msg_notice",
          conversationId: "conv_1",
          role: "system",
          content: "Compacted older messages into memory.",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: "compaction_notice",
          compactedAt: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "msg_user",
          conversationId: "conv_1",
          role: "user",
          content: "Continue",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 1,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        }
      ]
    });

    const systemMessage = prompt.find(m => m.role === "system");
    expect(systemMessage).not.toBeUndefined();
    expect(typeof systemMessage!.content).toBe("string");
    expect((systemMessage!.content as string)).toContain("Primary system prompt.");

    // Only one system message
    expect(prompt.filter(m => m.role === "system").length).toBe(1);

    // User message present
    expect(prompt.at(-1)!.role).toBe("user");
  });

  it("keeps image attachments multimodal and truncates attached text to the configured budget", () => {
    const prompt = buildPromptMessages({
      systemPrompt: "Stay concise.",
      activeMemoryNodes: [],
      maxAttachmentTextTokens: 4,
      messages: [
        {
          id: "msg_user",
          conversationId: "conv_1",
          role: "user",
          content: "Review these attachments",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 1,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString(),
          attachments: [
            {
              id: "att_image",
              conversationId: "conv_1",
              messageId: "msg_user",
              filename: "photo.png",
              mimeType: "image/png",
              byteSize: 123,
              sha256: "hash",
              relativePath: "conv_1/att_image_photo.png",
              kind: "image",
              extractedText: "",
              createdAt: new Date().toISOString()
            },
            {
              id: "att_text",
              conversationId: "conv_1",
              messageId: "msg_user",
              filename: "notes.txt",
              mimeType: "text/plain",
              byteSize: 123,
              sha256: "hash",
              relativePath: "conv_1/att_text_notes.txt",
              kind: "text",
              extractedText: "alpha beta gamma delta epsilon",
              createdAt: new Date().toISOString()
            }
          ]
        }
      ]
    });

    const userMessage = prompt.at(-1);

    expect(typeof userMessage?.content).not.toBe("string");
    expect(userMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", filename: "photo.png" }),
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("[truncated]")
        })
      ])
    );
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
        getPromptText(message).includes("Compacted Memory")
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

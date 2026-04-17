import {
  buildPromptMessages,
  ensureCompactedContext,
  getConversationDebugStats
} from "@/lib/compaction";
import { getDb } from "@/lib/db";
import { createConversation, createMessage, listMessages } from "@/lib/conversations";
import { getDefaultProviderProfileWithApiKey, updateSettings } from "@/lib/settings";
import { createMemory, deleteMemory } from "@/lib/memories";
import type { PromptMessage } from "@/lib/types";

vi.mock("@/lib/provider", async () => {
  return {
    callProviderText: vi.fn(async (input: { prompt: string }) => {
      // Scoring prompt detection
      if (input.prompt.includes("relevantNodes")) {
        const ids = [...input.prompt.matchAll(/\[node:\s*(mem_[a-z0-9-]+)\]/gi)]
          .map((match) => match[1]);
        return JSON.stringify({
          relevantNodes: ids.slice(0, Math.max(1, Math.ceil(ids.length / 2)))
        });
      }

      const ids = [...input.prompt.matchAll(/mem_[a-z0-9-]+|msg_[a-z0-9-]+/gi)]
        .map((match) => match[0]);

      return `- Fact from messages ${ids.slice(0, 3).join(", ")}
- Preference: keep context compact
- Unresolved: need to test scoring`;
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

  it("injects the latest assistant-generated image into the newest user turn when the user refers to it", () => {
    const createdAt = new Date().toISOString();
    const prompt = buildPromptMessages({
      systemPrompt: "Stay concise.",
      activeMemoryNodes: [],
      messages: [
        {
          id: "msg_user_1",
          conversationId: "conv_1",
          role: "user",
          content: "Generate a dramatic castle scene",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt
        },
        {
          id: "msg_assistant_1",
          conversationId: "conv_1",
          role: "assistant",
          content: "Generated 1 image.",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt,
          actions: [
            {
              id: "act_generated_1",
              messageId: "msg_assistant_1",
              kind: "image_generation",
              status: "completed",
              serverId: null,
              skillId: null,
              toolName: null,
              label: "Generate image",
              detail: "castle scene",
              arguments: null,
              resultSummary: "Generated 1 image",
              sortOrder: 0,
              startedAt: createdAt,
              completedAt: createdAt,
              proposalState: null,
              proposalPayload: null,
              proposalUpdatedAt: null
            }
          ],
          attachments: [
            {
              id: "att_generated_1",
              conversationId: "conv_1",
              messageId: "msg_assistant_1",
              filename: "generated-castle.png",
              mimeType: "image/png",
              byteSize: 321,
              sha256: "hash",
              relativePath: "conv_1/generated-castle.png",
              kind: "image",
              extractedText: "",
              createdAt
            }
          ]
        },
        {
          id: "msg_user_2",
          conversationId: "conv_1",
          role: "user",
          content: "Can you tell me what is the latest image you generated?",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 8,
          systemKind: null,
          compactedAt: null,
          createdAt
        }
      ]
    });

    const latestUserMessage = prompt.at(-1);

    expect(latestUserMessage?.role).toBe("user");
    expect(typeof latestUserMessage?.content).not.toBe("string");
    expect(latestUserMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: "Can you tell me what is the latest image you generated?"
        }),
        expect.objectContaining({
          type: "image",
          filename: "generated-castle.png"
        })
      ])
    );
  });

  it("does not inject assistant screenshot attachments into follow-up user turns", () => {
    const createdAt = new Date().toISOString();
    const prompt = buildPromptMessages({
      systemPrompt: "Stay concise.",
      activeMemoryNodes: [],
      messages: [
        {
          id: "msg_user_1",
          conversationId: "conv_1",
          role: "user",
          content: "Take a screenshot of atlantis.ninja",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt
        },
        {
          id: "msg_assistant_1",
          conversationId: "conv_1",
          role: "assistant",
          content: "I've attached the screenshot.",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt,
          actions: [
            {
              id: "act_screenshot_1",
              messageId: "msg_assistant_1",
              kind: "shell_command",
              status: "completed",
              serverId: null,
              skillId: null,
              toolName: null,
              label: "Web browser",
              detail: "agent-browser screenshot /tmp/atlantis.png --full",
              arguments: { command: "agent-browser screenshot /tmp/atlantis.png --full" },
              resultSummary: "Screenshot saved",
              sortOrder: 0,
              startedAt: createdAt,
              completedAt: createdAt,
              proposalState: null,
              proposalPayload: null,
              proposalUpdatedAt: null
            }
          ],
          attachments: [
            {
              id: "att_generated_1",
              conversationId: "conv_1",
              messageId: "msg_assistant_1",
              filename: "atlantis.png",
              mimeType: "image/png",
              byteSize: 321,
              sha256: "hash",
              relativePath: "conv_1/atlantis.png",
              kind: "image",
              extractedText: "",
              createdAt
            }
          ]
        },
        {
          id: "msg_user_2",
          conversationId: "conv_1",
          role: "user",
          content: "Can you tell me what is the latest image you generated?",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 8,
          systemKind: null,
          compactedAt: null,
          createdAt
        }
      ]
    });

    const latestUserMessage = prompt.at(-1);

    expect(latestUserMessage).toEqual({
      role: "user",
      content: "Can you tell me what is the latest image you generated?"
    });
  });

  it("does not inject a previous assistant image for unrelated prompts that merely say latest", () => {
    const createdAt = new Date().toISOString();
    const prompt = buildPromptMessages({
      systemPrompt: "Stay concise.",
      activeMemoryNodes: [],
      messages: [
        {
          id: "msg_user_1",
          conversationId: "conv_1",
          role: "user",
          content: "Generate a dramatic castle scene",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt
        },
        {
          id: "msg_assistant_1",
          conversationId: "conv_1",
          role: "assistant",
          content: "Generated 1 image.",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt,
          attachments: [
            {
              id: "att_generated_1",
              conversationId: "conv_1",
              messageId: "msg_assistant_1",
              filename: "generated-castle.png",
              mimeType: "image/png",
              byteSize: 321,
              sha256: "hash",
              relativePath: "conv_1/generated-castle.png",
              kind: "image",
              extractedText: "",
              createdAt
            }
          ]
        },
        {
          id: "msg_user_2",
          conversationId: "conv_1",
          role: "user",
          content: "What is the latest weather update?",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 6,
          systemKind: null,
          compactedAt: null,
          createdAt
        }
      ]
    });

    const latestUserMessage = prompt.at(-1);

    expect(latestUserMessage).toEqual({
      role: "user",
      content: "What is the latest weather update?"
    });
  });

  it("omits assistant reasoning and empty streaming placeholders from prompt messages", () => {
    const prompt = buildPromptMessages({
      systemPrompt: "Stay concise.",
      activeMemoryNodes: [],
      messages: [
        {
          id: "msg_user",
          conversationId: "conv_1",
          role: "user",
          content: "What should I do next?",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 1,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "msg_assistant",
          conversationId: "conv_1",
          role: "assistant",
          content: "Proceed with the rollout.",
          thinkingContent: "Internal reasoning that should stay out of prompt context.",
          status: "completed",
          estimatedTokens: 8,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "msg_streaming",
          conversationId: "conv_1",
          role: "assistant",
          content: "",
          thinkingContent: "",
          status: "streaming",
          estimatedTokens: 0,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        }
      ]
    });

    const assistantMessages = prompt.filter((message) => message.role === "assistant");

    expect(assistantMessages).toHaveLength(1);
    expect(getPromptText(assistantMessages[0]!)).toBe("Proceed with the rollout.");
    expect(getPromptText(assistantMessages[0]!)).not.toContain("Internal reasoning");
  });

  it("does not compact an unmatched trailing user message out of visible history", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      maxOutputTokens: 2000,
      compactionThreshold: 0.6
    });
    getDb()
      .prepare("UPDATE provider_profiles SET fresh_tail_count = ? WHERE id = ?")
      .run(2, "profile_default");

    const conversation = createConversation();
    const messageIds: string[] = [];

    for (let index = 0; index < 45; index += 1) {
      const message = createMessage({
        conversationId: conversation.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index} ${"dense context ".repeat(220)}`,
        thinkingContent: index % 2 === 1 ? "Reasoning " + "step ".repeat(24) : ""
      });
      messageIds.push(message.id);
    }

    messageIds.forEach((id, index) => {
      getDb()
        .prepare("UPDATE messages SET created_at = ? WHERE id = ?")
        .run(new Date(Date.UTC(2026, 3, 10, 19, 0, index)).toISOString(), id);
    });

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const messages = listMessages(conversation.id);
    const trailingEligibleUser = messages.find((message) => message.content.startsWith("Message 44"));
    const compactedOlderAssistant = messages.find((message) => message.content.startsWith("Message 1"));

    expect(result.didCompact).toBe(true);
    expect(trailingEligibleUser?.compactedAt).toBeNull();
    expect(compactedOlderAssistant?.compactedAt).not.toBeNull();
  });

  it("replays only the freshest completed turns instead of the whole visible raw history", async () => {
    updateDefaultProfile({
      modelContextLimit: 20000,
      compactionThreshold: 0.9
    });
    getDb()
      .prepare("UPDATE provider_profiles SET fresh_tail_count = ? WHERE id = ?")
      .run(2, "profile_default");

    const conversation = createConversation();

    for (let index = 0; index < 5; index += 1) {
      createMessage({
        conversationId: conversation.id,
        role: "user",
        content: `Turn ${index} user ${"context ".repeat(12)}`
      });
      createMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: `Turn ${index} assistant ${"context ".repeat(12)}`,
        thinkingContent: `Internal reasoning for turn ${index}`
      });
    }

    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Current user question"
    });

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const promptText = result.promptMessages.map((message) => getPromptText(message)).join("\n");

    expect(result.didCompact).toBe(false);
    expect(promptText).toContain("Turn 4 user");
    expect(promptText).toContain("Turn 4 assistant");
    expect(promptText).toContain("Turn 3 user");
    expect(promptText).toContain("Turn 3 assistant");
    expect(promptText).toContain("Current user question");
    expect(promptText).not.toContain("Turn 0 user");
    expect(promptText).not.toContain("Turn 1 assistant");
  });

  it("keeps the fresh completed-turn tail un-compacted when leaf compaction runs", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      maxOutputTokens: 2000,
      compactionThreshold: 0.6
    });
    getDb()
      .prepare("UPDATE provider_profiles SET fresh_tail_count = ? WHERE id = ?")
      .run(2, "profile_default");

    const conversation = createConversation();
    const messageIds: string[] = [];

    for (let index = 0; index < 18; index += 1) {
      const message = createMessage({
        conversationId: conversation.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Turn ${Math.floor(index / 2)} ${index % 2 === 0 ? "user" : "assistant"} ${"dense context ".repeat(240)}`,
        thinkingContent: index % 2 === 1 ? "Reasoning " + "step ".repeat(24) : ""
      });
      messageIds.push(message.id);
    }

    messageIds.forEach((id, index) => {
      getDb()
        .prepare("UPDATE messages SET created_at = ? WHERE id = ?")
        .run(new Date(Date.UTC(2026, 3, 10, 19, 10, index)).toISOString(), id);
    });

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const messages = listMessages(conversation.id);

    expect(result.didCompact).toBe(true);
    expect(messages.find((message) => message.content.startsWith("Turn 8 user"))?.compactedAt).toBeNull();
    expect(messages.find((message) => message.content.startsWith("Turn 8 assistant"))?.compactedAt).toBeNull();
    expect(messages.find((message) => message.content.startsWith("Turn 7 user"))?.compactedAt).toBeNull();
    expect(messages.find((message) => message.content.startsWith("Turn 7 assistant"))?.compactedAt).toBeNull();
    expect(messages.find((message) => message.content.startsWith("Turn 6 user"))?.compactedAt).not.toBeNull();
    expect(messages.find((message) => message.content.startsWith("Turn 6 assistant"))?.compactedAt).not.toBeNull();
  });

  it("records a compaction event when a leaf summary is created", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
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

    expect(result.didCompact).toBe(true);
    expect(stats.latestCompactionAt).not.toBeNull();
  });

  it("prefers rendered memory-node selection before compacting older raw turns when memory pressure is the overflow source", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      compactionThreshold: 0.7
    });
    getDb()
      .prepare("UPDATE provider_profiles SET fresh_tail_count = ? WHERE id = ?")
      .run(2, "profile_default");

    const conversation = createConversation();

    for (let index = 0; index < 10; index += 1) {
      createMessage({
        conversationId: conversation.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index} ${"dense context ".repeat(90)}`,
        thinkingContent: index % 2 === 1 ? "Reasoning " + "step ".repeat(24) : ""
      });
    }

    const timestamp = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO memory_nodes (
          id,
          conversation_id,
          type,
          depth,
          content,
          source_start_message_id,
          source_end_message_id,
          source_token_count,
          summary_token_count,
          child_node_ids,
          superseded_by_node_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        "mem_open",
        conversation.id,
        "leaf_summary",
        0,
        [
          "Goal:",
          "- Keep the memory pressure path stable",
          "Constraints:",
          "- Do not compact raw history unnecessarily",
          "Actions Taken:",
          "- Added deterministic selection",
          "Outcomes:",
          "- The live prompt should shrink memory context first",
          "Open Tasks:",
          "- Verify the overflow source",
          "Artifact References:",
          "- lib/compaction.ts",
          "Time Span:",
          "- 2026-04-10T10:00:00.000Z -> 2026-04-10T10:30:00.000Z",
          "Additional context:",
          "x ".repeat(900)
        ].join("\n"),
        "msg_mem_open_start",
        "msg_mem_open_end",
        80,
        400,
        JSON.stringify([]),
        timestamp
      );
    getDb()
      .prepare(
        `INSERT INTO memory_nodes (
          id,
          conversation_id,
          type,
          depth,
          content,
          source_start_message_id,
          source_end_message_id,
          source_token_count,
          summary_token_count,
          child_node_ids,
          superseded_by_node_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        "mem_generic",
        conversation.id,
        "leaf_summary",
        0,
        [
          "Goal:",
          "- Keep the memory pressure path stable",
          "Constraints:",
          "- This node is generic",
          "Actions Taken:",
          "- Added generic history",
          "Outcomes:",
          "- Should be deprioritized",
          "Open Tasks:",
          "- None",
          "Artifact References:",
          "- tests/unit/compaction.test.ts",
          "Time Span:",
          "- 2026-04-10T10:00:00.000Z -> 2026-04-10T10:30:00.000Z",
          "Additional context:",
          "y ".repeat(900)
        ].join("\n"),
        "msg_mem_generic_start",
        "msg_mem_generic_end",
        80,
        400,
        JSON.stringify([]),
        timestamp
      );

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const messages = listMessages(conversation.id);
    const systemMessage = result.promptMessages.find((message) => message.role === "system");
    const promptText = getPromptText(systemMessage!);

    expect(result.didCompact).toBe(false);
    expect(messages.every((message) => message.compactedAt === null)).toBe(true);
    expect(promptText).toContain("Verify the overflow source");
    expect(promptText).not.toContain("Should be deprioritized");
  });

  it("keeps memory nodes active when prompt pressure forces a fallback", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      compactionThreshold: 0.7
    });

    const conversation = createConversation();
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Need the latest summary"
    });

    const timestamp = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO memory_nodes (
          id,
          conversation_id,
          type,
          depth,
          content,
          source_start_message_id,
          source_end_message_id,
          source_token_count,
          summary_token_count,
          child_node_ids,
          superseded_by_node_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        "mem_fallback",
        conversation.id,
        "leaf_summary",
        0,
        [
          "Goal:",
          "- Keep this node available",
          "Constraints:",
          "- Do not delete memory nodes as pressure relief",
          "Actions Taken:",
          "- Added deterministic fallback handling",
          "Outcomes:",
          "- The prompt should fall back to the current user message instead",
          "Open Tasks:",
          "- Review the fallback path",
          "Artifact References:",
          "- lib/compaction.ts",
          "Time Span:",
          "- 2026-04-10T10:00:00.000Z -> 2026-04-10T10:30:00.000Z",
          "Additional context:",
          "x ".repeat(1200)
        ].join("\n"),
        "msg_mem_start",
        "msg_mem_end",
        80,
        80,
        JSON.stringify([]),
        timestamp
      );

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const memoryNode = getDb()
      .prepare(
        `SELECT superseded_by_node_id
         FROM memory_nodes
         WHERE id = ?`
      )
      .get("mem_fallback") as { superseded_by_node_id: string | null } | undefined;

    expect(result.promptMessages.some((message) => getPromptText(message).includes("Need the latest summary"))).toBe(true);
    expect(memoryNode?.superseded_by_node_id).toBeNull();
  });

  it("falls back to the latest user-only prompt when open-task memory nodes still overflow the budget", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      maxOutputTokens: 2000,
      compactionThreshold: 0.5
    });

    const conversation = createConversation();
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Keep only the latest request in view"
    });

    const timestamp = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO memory_nodes (
          id,
          conversation_id,
          type,
          depth,
          content,
          source_start_message_id,
          source_end_message_id,
          source_token_count,
          summary_token_count,
          child_node_ids,
          superseded_by_node_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        "mem_user_only_fallback",
        conversation.id,
        "leaf_summary",
        0,
        [
          "Goal:",
          "- Keep only the newest request when budget is exhausted",
          "Constraints:",
          "- Memory nodes may stay persisted even if omitted from the live prompt",
          "Actions Taken:",
          "- Exercise the user-only fallback path",
          "Outcomes:",
          "- The prompt should omit this memory block",
          "Open Tasks:",
          "- Confirm the latest user-only fallback path",
          "Artifact References:",
          "- lib/compaction.ts",
          "Time Span:",
          "- 2026-04-11T08:00:00.000Z -> 2026-04-11T08:05:00.000Z",
          "Additional context:",
          "fallback ".repeat(420)
        ].join("\n"),
        "msg_mem_user_only_fallback_start",
        "msg_mem_user_only_fallback_end",
        80,
        80,
        JSON.stringify([]),
        timestamp
      );

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const promptText = result.promptMessages.map((message) => getPromptText(message)).join("\n");

    expect(result.didCompact).toBe(false);
    expect(promptText).toContain("Keep only the latest request in view");
    expect(promptText).not.toContain("Confirm the latest user-only fallback path");
    expect(promptText).not.toContain("mem_user_only_fallback");
  });

  it("keeps rendered memory nodes when the prompt already fits even if stored summary counts are inflated", async () => {
    updateDefaultProfile({
      modelContextLimit: 12000,
      compactionThreshold: 0.9
    });

    const conversation = createConversation();
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Short follow-up"
    });

    const db = getDb();
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_legacy",
      conversation.id,
      "leaf_summary",
      0,
      JSON.stringify({
        factualCommitments: ["Use deterministic compaction"],
        userPreferences: ["Keep artifact references"],
        unresolvedItems: ["Review the live selector path"],
        importantReferences: ["lib/compaction-summary.ts"],
        chronology: ["2026-04-10"]
      }),
      "msg_legacy_start",
      "msg_legacy_end",
      40,
      999,
      JSON.stringify([]),
      timestamp
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_summary",
      conversation.id,
      "leaf_summary",
      0,
      [
        "Goal:",
        "- Keep all rendered memory nodes",
        "Constraints:",
        "- Do not drop nodes when the prompt fits",
        "Actions Taken:",
        "- Added deterministic summary helpers",
        "Outcomes:",
        "- Selection should preserve rendered context",
        "Open Tasks:",
        "- None",
        "Artifact References:",
        "- tests/unit/compaction-summary.test.ts",
        "Time Span:",
        "- 2026-04-10T10:00:00.000Z -> 2026-04-10T10:05:00.000Z"
      ].join("\n"),
      "msg_summary_start",
      "msg_summary_end",
      50,
      999,
      JSON.stringify([]),
      timestamp
    );

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const systemMessage = result.promptMessages.find((message) => message.role === "system");

    expect(result.didCompact).toBe(false);
    expect(typeof systemMessage?.content).toBe("string");
    expect(systemMessage?.content).toContain("Facts: Use deterministic compaction");
    expect(systemMessage?.content).toContain("Keep all rendered memory nodes");
    expect(systemMessage?.content).toContain("Review the live selector path");
  });

  it("rejects a raw-eligible slice when the completed-turn count falls below the leaf minimum", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      compactionThreshold: 0.7
    });
    getDb()
      .prepare("UPDATE provider_profiles SET fresh_tail_count = ? WHERE id = ?")
      .run(2, "profile_default");

    const conversation = createConversation();

    createMessage({ conversationId: conversation.id, role: "user", content: `Message 0 ${"dense context ".repeat(160)}` });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: `Message 1 ${"dense context ".repeat(160)}`,
      thinkingContent: "Reasoning " + "step ".repeat(24)
    });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "streaming"
    });
    createMessage({ conversationId: conversation.id, role: "user", content: `Message 3 ${"dense context ".repeat(160)}` });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: `Message 4 ${"dense context ".repeat(160)}`,
      thinkingContent: "Reasoning " + "step ".repeat(24)
    });
    createMessage({ conversationId: conversation.id, role: "user", content: `Message 5 ${"dense context ".repeat(160)}` });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: `Message 6 ${"dense context ".repeat(160)}`,
      thinkingContent: "Reasoning " + "step ".repeat(24)
    });
    createMessage({ conversationId: conversation.id, role: "user", content: `Message 7 ${"dense context ".repeat(160)}` });

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );
    const messages = listMessages(conversation.id);

    expect(result.didCompact).toBe(false);
    expect(messages.every((message) => message.compactedAt === null)).toBe(true);
  });

  it("compacts older turns without creating a visible compaction notice message", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
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

    const lifecycle: string[] = [];
    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!,
      {
        onCompactionStart() {
          lifecycle.push("start");
        },
        onCompactionEnd() {
          lifecycle.push("end");
        }
      }
    );
    const messages = listMessages(conversation.id);

    expect(result.didCompact).toBe(true);
    expect(lifecycle).toEqual(["start", "end"]);
    expect(messages.some((message) => message.systemKind === "compaction_notice")).toBe(false);
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

    expect(result.didCompact).toBe(false);
    await expect(
      ensureCompactedContext("missing", getDefaultProviderProfileWithApiKey()!)
    ).rejects.toThrow("Conversation not found");
  });

  it("falls back gracefully when the prompt is too large and nothing is eligible", async () => {
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

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );

    expect(result.promptMessages.some(m => m.role === "system")).toBe(true);
    expect(result.promptMessages.some(m => m.role === "user")).toBe(true);
  });

  it("throws when even the latest user-only fallback exceeds the context budget", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      maxOutputTokens: 2000,
      compactionThreshold: 0.5
    });

    const conversation = createConversation();
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: `Oversized ${"context ".repeat(1200)}`
    });

    await expect(
      ensureCompactedContext(
        conversation.id,
        getDefaultProviderProfileWithApiKey()!
      )
    ).rejects.toThrow("Conversation exceeds the configured context limit. No fallback available.");
  });
});

describe("buildPromptMessages with persona", () => {
  it("appends persona content after system prompt", () => {
    const messages: import("@/lib/types").Message[] = [
      {
        id: "1",
        conversationId: "c1",
        role: "user",
        content: "Hello",
        status: "completed",
        estimatedTokens: 10,
        thinkingContent: "",
        systemKind: null,
        compactedAt: null,
        createdAt: new Date().toISOString()
      }
    ];
    const result = buildPromptMessages({
      systemPrompt: "You are a helpful assistant.",
      personaContent: "You are a finance expert. Focus on tax implications.",
      messages,
      activeMemoryNodes: []
    });

    expect(result[0].role).toBe("system");
    const systemContent = result[0].content as string;
    expect(systemContent).toContain("You are a helpful assistant.");
    expect(systemContent).toContain("You are a finance expert. Focus on tax implications.");
  });

  it("works without persona content", () => {
    const messages: import("@/lib/types").Message[] = [
      {
        id: "1",
        conversationId: "c1",
        role: "user",
        content: "Hello",
        status: "completed",
        estimatedTokens: 10,
        thinkingContent: "",
        systemKind: null,
        compactedAt: null,
        createdAt: new Date().toISOString()
      }
    ];
    const result = buildPromptMessages({
      systemPrompt: "You are a helpful assistant.",
      messages,
      activeMemoryNodes: []
    });

    expect(result[0].role).toBe("system");
    const systemContent = result[0].content as string;
    expect(systemContent).toBe("You are a helpful assistant.");
  });
});

describe("buildPromptMessages with memories", () => {
  it("includes memory block and tool instructions when memoriesEnabled and memories exist", () => {
    const mem = createMemory("User lives in Montreal", "location");
    try {
      const result = buildPromptMessages({
        systemPrompt: "Be helpful.",
        activeMemoryNodes: [],
        messages: [
          {
            id: "1",
            conversationId: "c1",
            role: "user",
            content: "Hi",
            status: "completed",
            estimatedTokens: 5,
            thinkingContent: "",
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString()
          }
        ],
        memoriesEnabled: true
      });

      const systemContent = result[0].content as string;
      expect(systemContent).toContain("<memory>");
      expect(systemContent).toContain("User lives in Montreal");
      expect(systemContent).toContain("create_memory");
    } finally {
      deleteMemory(mem.id);
    }
  });

  it("does not include memory block when memoriesEnabled is false", () => {
    const mem = createMemory("User lives in Montreal", "location");
    try {
      const result = buildPromptMessages({
        systemPrompt: "Be helpful.",
        activeMemoryNodes: [],
        messages: [
          {
            id: "1",
            conversationId: "c1",
            role: "user",
            content: "Hi",
            status: "completed",
            estimatedTokens: 5,
            thinkingContent: "",
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString()
          }
        ],
        memoriesEnabled: false
      });

      const systemContent = result[0].content as string;
      expect(systemContent).not.toContain("<memory>");
      expect(systemContent).not.toContain("create_memory");
    } finally {
      deleteMemory(mem.id);
    }
  });

  it("does not include tool instructions when no memories exist", () => {
    const result = buildPromptMessages({
      systemPrompt: "Be helpful.",
      activeMemoryNodes: [],
      messages: [
        {
          id: "1",
          conversationId: "c1",
          role: "user",
          content: "Hi",
          status: "completed",
          estimatedTokens: 5,
          thinkingContent: "",
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        }
      ],
      memoriesEnabled: true
    });

    const systemContent = result[0].content as string;
    expect(systemContent).not.toContain("<memory>");
    expect(systemContent).not.toContain("create_memory");
  });
});

describe("getConversationDebugStats", () => {
  it("returns stats for an existing conversation", () => {
    const conversation = createConversation();
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Hello"
    });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Hi there"
    });

    const stats = getConversationDebugStats(conversation.id);
    expect(stats.rawTurnCount).toBe(2);
    expect(stats.memoryNodeCount).toBe(0);
    expect(stats.latestCompactionAt).toBeNull();
  });
});

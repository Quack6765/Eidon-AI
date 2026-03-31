import type { ChatStreamEvent, Skill } from "@/lib/types";

const streamProviderResponse = vi.fn();

vi.mock("@/lib/provider", () => ({
  streamProviderResponse
}));

function createProviderStream(
  events: ChatStreamEvent[],
  result: { answer: string; thinking: string; usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } }
) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }

    return result;
  })();
}

function createSettings() {
  return {
    id: "profile_test",
    name: "Test profile",
    apiBaseUrl: "https://api.example.com/v1",
    apiKeyEncrypted: "",
    apiKey: "sk-test",
    model: "gpt-5-mini",
    apiMode: "responses" as const,
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    reasoningEffort: "medium" as const,
    reasoningSummaryEnabled: true,
    modelContextLimit: 16000,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_release_notes",
    name: "Release Notes",
    description: "Use when writing customer-facing summaries of product changes.",
    content: "Summarize changes for end users in concise release notes.",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("skill runtime", () => {
  beforeEach(() => {
    streamProviderResponse.mockReset();
  });

  it("exposes metadata without full instructions in the initial message", async () => {
    const { buildSkillsMetadataMessage } = await import("@/lib/skill-runtime");

    const message = buildSkillsMetadataMessage([createSkill()]);

    expect(message).toContain("Release Notes");
    expect(message).toContain("Use when writing customer-facing summaries of product changes.");
    expect(message).not.toContain("Summarize changes for end users in concise release notes.");
  });

  it("loads a requested skill body before emitting the final answer", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: 'SKILL_REQUEST: {"skills":["Release Notes"]}',
          thinking: "",
          usage: { inputTokens: 10 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done",
          thinking: "",
          usage: { inputTokens: 20, outputTokens: 1 }
        })
      );

    const { resolveAssistantWithSkills } = await import("@/lib/skill-runtime");
    const emitted: ChatStreamEvent[] = [];

    const result = await resolveAssistantWithSkills({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Write release notes" }],
      skills: [createSkill()],
      onEvent: (event) => emitted.push(event)
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(2);
    expect(streamProviderResponse.mock.calls[0][0].promptMessages.at(-1)?.content).toContain(
      "You currently have access only to skill metadata."
    );
    expect(streamProviderResponse.mock.calls[1][0].promptMessages.at(-1)?.content).toContain(
      "Summarize changes for end users in concise release notes."
    );
    expect(emitted).toEqual([{ type: "answer_delta", text: "Done" }]);
    expect(result.answer).toBe("Done");
    expect(result.usage.outputTokens).toBe(1);
  });

  it("passes through the first answer when no skill request is made", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Hello" }], {
        answer: "Hello",
        thinking: "",
        usage: { inputTokens: 5, outputTokens: 1 }
      })
    );

    const { resolveAssistantWithSkills } = await import("@/lib/skill-runtime");
    const emitted: ChatStreamEvent[] = [];

    const result = await resolveAssistantWithSkills({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Say hello" }],
      skills: [createSkill()],
      onEvent: (event) => emitted.push(event)
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([{ type: "answer_delta", text: "Hello" }]);
    expect(result.answer).toBe("Hello");
  });
});

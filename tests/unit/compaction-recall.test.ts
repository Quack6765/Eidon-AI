import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMemoriesForPrompt } = vi.hoisted(() => ({ selectMemoriesForPrompt: vi.fn() }));

vi.mock("@/lib/memory-recall", () => ({
  selectMemoriesForPrompt
}));

vi.mock("@/lib/provider", () => ({
  callProviderText: vi.fn(async () => "- summary")
}));

import { buildPromptMessages, ensureCompactedContext } from "@/lib/compaction";
import { createConversation, createMessage } from "@/lib/conversations";
import { createMemory } from "@/lib/memories";
import type { UserMemory } from "@/lib/types";
import { createLocalUser } from "@/lib/users";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

async function createUser(username: string) {
  return createLocalUser({ username, password: "Password123!", role: "user" });
}

const roomyProfile = {
  modelContextLimit: 16000,
  maxOutputTokens: 1000,
  safetyMarginTokens: 200,
  compactionThreshold: 0.8,
  freshTailCount: 8
};

function systemText(messages: ReturnType<typeof buildPromptMessages>) {
  return messages[0].content as string;
}

describe("memory selection in prompts", () => {
  beforeEach(() => {
    selectMemoriesForPrompt.mockReset();
  });

  it("uses selectedMemories in place of the full memory list and is byte-identical when absent", async () => {
    const user = await createUser("prompt-selection");
    const kept = createMemory("Keep me", "work", user.id);
    const dropped = createMemory("Drop me", "other", user.id);
    const base = {
      systemPrompt: "System",
      messages: [],
      activeMemoryNodes: [],
      memoriesEnabled: true,
      memoryUserId: user.id
    };

    const full = systemText(buildPromptMessages(base));
    expect(full).toContain(`${kept.id}: [work] Keep me`);
    expect(full).toContain(`${dropped.id}: [other] Drop me`);
    expect(systemText(buildPromptMessages({ ...base, selectedMemories: undefined }))).toBe(full);

    const selected = systemText(buildPromptMessages({ ...base, selectedMemories: [kept] }));
    expect(selected).toContain(`${kept.id}: [work] Keep me`);
    expect(selected).not.toContain("Drop me");

    const empty = systemText(buildPromptMessages({ ...base, selectedMemories: [] }));
    expect(empty).not.toContain("<memory>");
    expect(empty).toContain("memory");
  });

  it("threads the selection through ensureCompactedContext and reports the counts", async () => {
    const user = await createUser("ensure-selection");
    const memories: UserMemory[] = [];
    for (let index = 0; index < 3; index += 1) memories.push(createMemory(`Fact ${index}`, "other", user.id));
    selectMemoriesForPrompt.mockResolvedValue({ selected: [memories[1]], total: 3 });

    const conversation = createConversation("Recall", null, undefined, user.id);
    createMessage({ conversationId: conversation.id, role: "user", content: "What do you remember?" });
    const settings = createRuntimeProviderProfile(roomyProfile);

    const result = await ensureCompactedContext(conversation.id, settings, {}, undefined, true, "balanced");
    const text = result.promptMessages[0].content as string;

    expect(selectMemoriesForPrompt).toHaveBeenCalledWith(user.id, undefined, "What do you remember?");
    expect(text).toContain("Fact 1");
    expect(text).not.toContain("Fact 0");
    expect(result.memoriesUsed).toBe(1);
    expect(result.memoriesTotal).toBe(3);
  });

  it("falls back to every memory and omits counts when selection is unavailable or throws", async () => {
    const user = await createUser("ensure-fallback");
    createMemory("Fact A", "other", user.id);
    createMemory("Fact B", "other", user.id);
    const conversation = createConversation("Fallback", null, undefined, user.id);
    createMessage({ conversationId: conversation.id, role: "user", content: "Hello" });
    const settings = createRuntimeProviderProfile(roomyProfile);

    selectMemoriesForPrompt.mockResolvedValue(null);
    const unavailable = await ensureCompactedContext(conversation.id, settings, {}, undefined, true, "balanced");
    expect(unavailable.promptMessages[0].content).toContain("Fact A");
    expect(unavailable.promptMessages[0].content).toContain("Fact B");
    expect(unavailable.memoriesUsed).toBeUndefined();

    selectMemoriesForPrompt.mockRejectedValue(new Error("boom"));
    const failed = await ensureCompactedContext(conversation.id, settings, {}, undefined, true, "balanced");
    expect(failed.promptMessages[0].content).toContain("Fact A");

    selectMemoriesForPrompt.mockClear();
    await ensureCompactedContext(conversation.id, settings, {}, undefined, false, "balanced");
    expect(selectMemoriesForPrompt).not.toHaveBeenCalled();
  });

  it("drops the memory block instead of throwing when only memories overflow the context", async () => {
    const user = await createUser("ensure-overflow");
    for (let index = 0; index < 40; index += 1) {
      createMemory(`${"memory ".repeat(40)}${index}`, "other", user.id);
    }
    selectMemoriesForPrompt.mockResolvedValue(null);
    const conversation = createConversation("Overflow", null, undefined, user.id);
    createMessage({ conversationId: conversation.id, role: "user", content: "Short question" });
    const settings = createRuntimeProviderProfile({
      systemPrompt: "Sys",
      modelContextLimit: 1400,
      maxOutputTokens: 100,
      safetyMarginTokens: 50,
      compactionThreshold: 0.9,
      freshTailCount: 2
    });

    const result = await ensureCompactedContext(conversation.id, settings, {}, undefined, true, "balanced");
    const text = result.promptMessages[0].content as string;
    expect(text).not.toContain("<memory>");
    expect(result.promptMessages.at(-1)?.content).toContain("Short question");
    expect(result.promptTokens).toBeLessThanOrEqual(1125);
  });
});

import fs from "node:fs";
import path from "node:path";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  listConversationsPage,
  searchConversations,
  createMessage,
  getConversationSnapshot
} from "@/lib/conversations";
import { resetDbForTests } from "@/lib/db";
import { updateSettings } from "@/lib/settings";

describe("temporary chat", () => {
  beforeEach(() => {
    resetDbForTests();
    updateSettings({
      defaultProviderProfileId: "profile_default",
      skillsEnabled: true,
      providerProfiles: [
        {
          id: "profile_default",
          name: "Default",
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-5-mini",
          apiMode: "responses",
          systemPrompt: "Be exact.",
          temperature: 0.2,
          maxOutputTokens: 512,
          reasoningEffort: "medium",
          reasoningSummaryEnabled: true,
          modelContextLimit: 16000,
          compactionThreshold: 0.8,
          freshTailCount: 12
        }
      ]
    });
  });

  it("creates a temporary conversation with isTemporary flag", () => {
    const conv = createConversation(null, null, { isTemporary: true });
    expect(conv.isTemporary).toBe(true);

    const loaded = getConversation(conv.id);
    expect(loaded?.isTemporary).toBe(true);
  });

  it("creates a regular conversation without isTemporary by default", () => {
    const conv = createConversation();
    expect(conv.isTemporary).toBe(false);
  });

  it("excludes temporary conversations from listConversations", () => {
    createConversation("Regular", null, undefined);
    createConversation("Temp", null, { isTemporary: true });

    const all = listConversations();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Regular");
  });

  it("excludes temporary conversations from listConversationsPage", () => {
    createConversation("Regular", null, undefined);
    createConversation("Temp", null, { isTemporary: true });

    const page = listConversationsPage({ limit: 10 });
    expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0].title).toBe("Regular");
  });

  it("excludes temporary conversations from searchConversations", () => {
    const regular = createConversation("Important Topic", null, undefined);
    createConversation("Important Secret", null, { isTemporary: true });
    createMessage({ conversationId: regular.id, role: "user", content: "Important details here" });

    const results = searchConversations("Important");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Important Topic");
  });

  it("can delete a temporary conversation", () => {
    const conv = createConversation(null, null, { isTemporary: true });
    expect(deleteConversation(conv.id)).toBe(true);
    expect(getConversation(conv.id)).toBeNull();
  });

  it("temporary conversation supports full snapshot with messages", () => {
    const conv = createConversation(null, null, { isTemporary: true });
    createMessage({ conversationId: conv.id, role: "user", content: "Hello temp" });
    createMessage({ conversationId: conv.id, role: "assistant", content: "Hi there" });

    const snapshot = getConversationSnapshot(conv.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.conversation.isTemporary).toBe(true);
    expect(snapshot!.messages.length).toBe(2);
  });
});

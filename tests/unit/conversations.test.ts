import {
  createConversation,
  createMessage,
  getConversation,
  getMessage,
  listMessages,
  markMessagesCompacted,
  maybeRetitleConversationFromFirstUserMessage,
  updateConversationProviderProfile
} from "@/lib/conversations";
import { getSettings, listProviderProfiles } from "@/lib/settings";

describe("conversation helpers", () => {
  it("creates conversations and retitles them from the first user message", () => {
    const conversation = createConversation();
    const defaultProfileId = getSettings().defaultProviderProfileId;

    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Build a small deployment checklist for me"
    });

    maybeRetitleConversationFromFirstUserMessage(conversation.id);

    expect(getConversation(conversation.id)?.title).toBe(
      "Build a small deployment checklist for me"
    );
    expect(getConversation(conversation.id)?.providerProfileId).toBe(defaultProfileId);
  });

  it("stores messages in chronological order", () => {
    const conversation = createConversation();

    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "First"
    });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Second"
    });

    const messages = listMessages(conversation.id);

    expect(messages.map((message) => message.content)).toEqual(["First", "Second"]);
  });

  it("retrieves and compacts messages, and handles missing rows safely", () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Reply",
      thinkingContent: "Reasoning"
    });

    expect(getConversation("missing")).toBeNull();
    expect(getMessage(message.id)?.thinkingContent).toBe("Reasoning");
    expect(getMessage("missing")).toBeNull();

    markMessagesCompacted([]);
    markMessagesCompacted([message.id]);

    expect(getMessage(message.id)?.compactedAt).not.toBeNull();
    maybeRetitleConversationFromFirstUserMessage(conversation.id);
    expect(getConversation(conversation.id)?.title).toBe("New conversation");
  });

  it("updates the conversation provider profile", () => {
    const conversation = createConversation();
    const nextProfileId = listProviderProfiles().at(-1)?.id ?? getSettings().defaultProviderProfileId;

    updateConversationProviderProfile(conversation.id, nextProfileId);

    expect(getConversation(conversation.id)?.providerProfileId).toBe(nextProfileId);
  });
});

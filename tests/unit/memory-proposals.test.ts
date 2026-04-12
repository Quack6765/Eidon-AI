import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConversation,
  createMessage,
  createMessageAction,
  getMessage
} from "@/lib/conversations";
import { createMemory, deleteMemory, getMemory, getMemoryCount, listMemories } from "@/lib/memories";
import {
  approveMemoryProposal,
  buildCreateMemoryProposal,
  buildDeleteMemoryProposal,
  buildUpdateMemoryProposal,
  dismissMemoryProposal
} from "@/lib/memory-proposals";
import { getSettings, listProviderProfilesWithApiKeys, updateSettings } from "@/lib/settings";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

function buildRouteUser(userId: string) {
  return {
    id: userId,
    username: "memory-route-user",
    role: "user" as const,
    authSource: "local" as const,
    passwordManagedBy: "local" as const,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z"
  };
}

function updateMemoryLimit(limit: number) {
  const current = getSettings();
  const providerProfiles = listProviderProfilesWithApiKeys();

  updateSettings({
    defaultProviderProfileId: current.defaultProviderProfileId ?? providerProfiles[0]?.id ?? "profile_default",
    skillsEnabled: current.skillsEnabled,
    conversationRetention: current.conversationRetention,
    memoriesEnabled: current.memoriesEnabled,
    memoriesMaxCount: limit,
    mcpTimeout: current.mcpTimeout,
    providerProfiles
  });
}

async function createUserConversationFixture(username: string) {
  const user = await createLocalUser({
    username,
    password: "Password123!",
    role: "user"
  });
  const conversation = createConversation(undefined, undefined, undefined, user.id);
  const message = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0
  });

  return { user, conversation, message };
}

describe("memory proposal approval helpers", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("approving a create proposal writes a memory and marks the action approved", async () => {
    const { user, message } = await createUserConversationFixture("memory-create-approve");
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: buildCreateMemoryProposal({
        content: "User prefers dark roast coffee",
        category: "preference"
      })
    });

    const action = approveMemoryProposal(created.id, undefined, user.id);

    expect(getMemoryCount(user.id)).toBe(1);
    expect(listMemories(user.id)).toEqual([
      expect.objectContaining({
        content: "User prefers dark roast coffee",
        category: "preference"
      })
    ]);
    expect(action).toEqual(
      expect.objectContaining({
        id: created.id,
        status: "completed",
        resultSummary: "Approved",
        proposalState: "approved",
        proposalPayload: {
          operation: "create",
          targetMemoryId: null,
          proposedMemory: {
            content: "User prefers dark roast coffee",
            category: "preference"
          }
        }
      })
    );
    expect(action.completedAt).toBeTruthy();
    expect(action.proposalUpdatedAt).toBeTruthy();
    expect(getMessage(message.id)?.actions?.[0]).toEqual(expect.objectContaining({ proposalState: "approved" }));
  });

  it("dismissing a delete proposal leaves the memory untouched and marks the action dismissed", async () => {
    const { user, message } = await createUserConversationFixture("memory-delete-dismiss");
    const memory = createMemory("User lives in Toronto", "location", user.id);
    const created = createMessageAction({
      messageId: message.id,
      kind: "delete_memory",
      status: "pending",
      label: "Delete memory proposal",
      proposalState: "pending",
      proposalPayload: buildDeleteMemoryProposal(memory)
    });

    const action = dismissMemoryProposal(created.id, user.id);

    expect(getMemory(memory.id, user.id)).toEqual(expect.objectContaining({ id: memory.id }));
    expect(action).toEqual(
      expect.objectContaining({
        id: created.id,
        status: "completed",
        resultSummary: "Ignored",
        proposalState: "dismissed",
        proposalPayload: buildDeleteMemoryProposal(memory)
      })
    );
    expect(action.completedAt).toBeTruthy();
    expect(action.proposalUpdatedAt).toBeTruthy();
  });

  it("approving an update proposal fails if the target memory no longer exists", async () => {
    const { user, message } = await createUserConversationFixture("memory-update-missing");
    const memory = createMemory("User works remotely", "work", user.id);
    const created = createMessageAction({
      messageId: message.id,
      kind: "update_memory",
      status: "pending",
      label: "Update memory proposal",
      proposalState: "pending",
      proposalPayload: buildUpdateMemoryProposal({
        memory,
        content: "User works remotely from home",
        category: "work"
      })
    });

    createMemory("unrelated", "other", user.id);
    expect(getMemory(memory.id, user.id)).toBeTruthy();

    // Simulate the target being removed before approval.
    deleteMemory(memory.id, user.id);

    expect(() => approveMemoryProposal(created.id, undefined, user.id)).toThrow("Target memory no longer exists");
  });

  it("approving a delete proposal fails if the target memory no longer exists", async () => {
    const { user, message } = await createUserConversationFixture("memory-delete-missing");
    const memory = createMemory("User has a standing desk", "work", user.id);
    const created = createMessageAction({
      messageId: message.id,
      kind: "delete_memory",
      status: "pending",
      label: "Delete memory proposal",
      proposalState: "pending",
      proposalPayload: buildDeleteMemoryProposal(memory)
    });

    deleteMemory(memory.id, user.id);

    expect(() => approveMemoryProposal(created.id, undefined, user.id)).toThrow("Target memory no longer exists");
  });

  it("approving an update proposal fails if the target memory changed after the proposal was created", async () => {
    const { user, message } = await createUserConversationFixture("memory-update-stale");
    const memory = createMemory("User prefers tea", "preference", user.id);
    const created = createMessageAction({
      messageId: message.id,
      kind: "update_memory",
      status: "pending",
      label: "Update memory proposal",
      proposalState: "pending",
      proposalPayload: buildUpdateMemoryProposal({
        memory,
        content: "User prefers green tea",
        category: "preference"
      })
    });

    const changed = await import("@/lib/memories");
    changed.updateMemory(memory.id, { content: "User prefers coffee" }, user.id);

    expect(() => approveMemoryProposal(created.id, undefined, user.id)).toThrow(
      "Target memory changed since this proposal was created"
    );
    expect(getMemory(memory.id, user.id)).toEqual(
      expect.objectContaining({
        content: "User prefers coffee",
        category: "preference"
      })
    );
  });

  it("approving a delete proposal fails if the target memory changed after the proposal was created", async () => {
    const { user, message } = await createUserConversationFixture("memory-delete-stale");
    const memory = createMemory("User lives in Toronto", "location", user.id);
    const created = createMessageAction({
      messageId: message.id,
      kind: "delete_memory",
      status: "pending",
      label: "Delete memory proposal",
      proposalState: "pending",
      proposalPayload: buildDeleteMemoryProposal(memory)
    });

    const changed = await import("@/lib/memories");
    changed.updateMemory(memory.id, { category: "personal" }, user.id);

    expect(() => approveMemoryProposal(created.id, undefined, user.id)).toThrow(
      "Target memory changed since this proposal was created"
    );
    expect(getMemory(memory.id, user.id)).toEqual(
      expect.objectContaining({
        content: "User lives in Toronto",
        category: "personal"
      })
    );
  });

  it("approving a create proposal with overrides applies the edited content and category", async () => {
    const { user, message } = await createUserConversationFixture("memory-create-overrides");
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: buildCreateMemoryProposal({
        content: "User likes tea",
        category: "other"
      })
    });

    const action = approveMemoryProposal(
      created.id,
      {
        content: "User prefers jasmine tea",
        category: "preference"
      },
      user.id
    );

    expect(listMemories(user.id)).toEqual([
      expect.objectContaining({
        content: "User prefers jasmine tea",
        category: "preference"
      })
    ]);
    expect(action.proposalPayload).toEqual({
      operation: "create",
      targetMemoryId: null,
      proposedMemory: {
        content: "User prefers jasmine tea",
        category: "preference"
      }
    });
  });

  it("approving a create proposal fails when the memory limit is reached", async () => {
    const { user, message } = await createUserConversationFixture("memory-create-limit");
    updateMemoryLimit(1);
    createMemory("Existing memory", "personal", user.id);

    const created = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: buildCreateMemoryProposal({
        content: "New memory proposal",
        category: "other"
      })
    });

    expect(() => approveMemoryProposal(created.id, undefined, user.id)).toThrow(
      "Memory limit reached (1/1). Update or delete an existing memory instead."
    );
    expect(getMemoryCount(user.id)).toBe(1);
    expect(getMessage(message.id)?.actions?.[0]).toEqual(expect.objectContaining({ proposalState: "pending" }));
  });

  it("rejects missing or non-pending proposal actions", async () => {
    const { user, message } = await createUserConversationFixture("memory-invalid-proposals");

    const missingPayload = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Broken proposal",
      proposalState: "pending",
      proposalPayload: null
    });

    const alreadyDismissed = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "completed",
      label: "Dismissed proposal",
      proposalState: "dismissed",
      proposalPayload: buildCreateMemoryProposal({
        content: "Should not apply",
        category: "other"
      })
    });

    expect(() => approveMemoryProposal("act_missing", undefined, user.id)).toThrow("Memory proposal not found");
    expect(() => approveMemoryProposal(missingPayload.id, undefined, user.id)).toThrow(
      "Memory proposal payload is missing"
    );
    expect(() => dismissMemoryProposal(alreadyDismissed.id, user.id)).toThrow(
      "Memory proposal is no longer pending"
    );
  });
});

describe("memory proposal approval routes", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("approves a proposal through the route with override validation", async () => {
    const { user, message } = await createUserConversationFixture("memory-approve-route");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));

    const created = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: buildCreateMemoryProposal({
        content: "User likes sketching",
        category: "other"
      })
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/approve/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "User sketches every weekend",
          category: "personal"
        })
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: expect.objectContaining({
        id: created.id,
        status: "completed",
        proposalState: "approved",
        resultSummary: "Approved",
        proposalPayload: {
          operation: "create",
          targetMemoryId: null,
          proposedMemory: {
            content: "User sketches every weekend",
            category: "personal"
          }
        }
      })
    });
    expect(listMemories(user.id)).toEqual([
      expect.objectContaining({
        content: "User sketches every weekend",
        category: "personal"
      })
    ]);
  });

  it("rejects invalid approval override bodies", async () => {
    const { user } = await createUserConversationFixture("memory-approve-route-invalid");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));

    const { POST } = await import("@/app/api/message-actions/[actionId]/approve/route");
    const response = await POST(
      new Request("http://localhost/api/message-actions/act_123/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "",
          category: "invalid"
        })
      }),
      { params: Promise.resolve({ actionId: "act_123" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid approval overrides" });
  });

  it("dismisses a proposal through the route without mutating memories", async () => {
    const { user, message } = await createUserConversationFixture("memory-dismiss-route");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    const memory = createMemory("User bikes to work", "work", user.id);

    const created = createMessageAction({
      messageId: message.id,
      kind: "delete_memory",
      status: "pending",
      label: "Delete memory proposal",
      proposalState: "pending",
      proposalPayload: buildDeleteMemoryProposal(memory)
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/dismiss/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/dismiss`, {
        method: "POST"
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: expect.objectContaining({
        id: created.id,
        status: "completed",
        proposalState: "dismissed",
        resultSummary: "Ignored"
      })
    });
    expect(getMemory(memory.id, user.id)).toEqual(expect.objectContaining({ id: memory.id }));
  });

  it("rejects approving another user's proposal through the route", async () => {
    const owner = await createUserConversationFixture("memory-approve-cross-owner");
    const otherUser = await createLocalUser({
      username: "memory-approve-cross-other",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(buildRouteUser(otherUser.id));

    const created = createMessageAction({
      messageId: owner.message.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: buildCreateMemoryProposal({
        content: "Owner memory proposal",
        category: "other"
      })
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/approve/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Memory proposal not found" });
    expect(listMemories(owner.user.id)).toEqual([]);
  });

  it("rejects dismissing another user's proposal through the route", async () => {
    const owner = await createUserConversationFixture("memory-dismiss-cross-owner");
    const otherUser = await createLocalUser({
      username: "memory-dismiss-cross-other",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(buildRouteUser(otherUser.id));

    const memory = createMemory("Owner memory", "personal", owner.user.id);
    const created = createMessageAction({
      messageId: owner.message.id,
      kind: "delete_memory",
      status: "pending",
      label: "Delete memory proposal",
      proposalState: "pending",
      proposalPayload: buildDeleteMemoryProposal(memory)
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/dismiss/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/dismiss`, {
        method: "POST"
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Memory proposal not found" });
    expect(getMemory(memory.id, owner.user.id)).toEqual(expect.objectContaining({ id: memory.id }));
  });
});

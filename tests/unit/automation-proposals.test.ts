import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConversation,
  createMessage,
  createMessageAction,
  getMessage,
  getMessageActionKind
} from "@/lib/conversations";
import { listAutomations } from "@/lib/automations";
import {
  approveAutomationProposal,
  dismissAutomationProposal
} from "@/lib/automation-proposals";
import { executeCreateAutomationProposal } from "@/lib/tool-executors";
import { updateProviderCatalog } from "@/lib/settings";
import { createLocalUser } from "@/lib/users";
import { createProviderProfileInput, createRuntimeProviderProfile } from "@/tests/provider-fixtures";
import type { AutomationProposalPayload, PromptMessage } from "@/lib/types";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

const PROVIDER_PROFILE_ID = "profile_auto_proposals";

function buildRouteUser(userId: string) {
  return {
    id: userId,
    username: "automation-route-user",
    role: "user" as const,
    authSource: "local" as const,
    passwordManagedBy: "local" as const,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z"
  };
}

function registerProviderProfile() {
  updateProviderCatalog({
    defaultProviderProfileId: PROVIDER_PROFILE_ID,
    skillsEnabled: false,
    providerProfiles: [
      createProviderProfileInput({
        id: PROVIDER_PROFILE_ID,
        name: "Automation Proposals Test",
        model: "gpt-test",
        systemPrompt: "Be exact.",
        temperature: 0.2,
        maxOutputTokens: 512,
        modelContextLimit: 16384,
        freshTailCount: 12,
        visionMode: "none",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z"
      })
    ]
  });
}

function buildAutomationPayload(
  overrides: Partial<AutomationProposalPayload> = {}
): AutomationProposalPayload {
  return {
    name: "Morning brief",
    prompt: "Summarize today's priorities for {{date}}.",
    scheduleKind: "calendar",
    intervalMinutes: null,
    calendarFrequency: "daily",
    timeOfDay: "08:30",
    daysOfWeek: [],
    providerProfileId: PROVIDER_PROFILE_ID,
    personaId: null,
    continuePreviousConversation: false,
    ...overrides
  };
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

function buildExecutorContext() {
  const startedActions: Array<Record<string, unknown>> = [];
  return {
    context: {
      input: {
        settings: createRuntimeProviderProfile({ id: PROVIDER_PROFILE_ID }),
        onActionStart: async (action: Record<string, unknown>) => {
          startedActions.push(action);
          return "act_auto";
        }
      },
      timelineSortOrder: 3,
      promptMessages: [] as PromptMessage[]
    },
    startedActions
  };
}

describe("create_automation tool executor", () => {
  it("creates a pending proposal action with payload and returns a proposal tool result", async () => {
    const { context, startedActions } = buildExecutorContext();

    const result = await executeCreateAutomationProposal(
      "call_auto_1",
      {
        name: "Morning brief",
        prompt: "Summarize today's priorities for {{date}}.",
        schedule_kind: "calendar",
        calendar_frequency: "daily",
        time_of_day: "08:30",
        days_of_week: [],
        continue_previous_conversation: true
      },
      context
    );

    expect(startedActions).toHaveLength(1);
    expect(startedActions[0]).toEqual(
      expect.objectContaining({
        kind: "create_automation",
        status: "pending",
        proposalState: "pending",
        proposalPayload: buildAutomationPayload({ continuePreviousConversation: true })
      })
    );
    const toolResult = result.promptMessages.at(-1);
    expect(toolResult?.role).toBe("tool");
    expect(toolResult?.content).toContain("awaiting user approval");
    expect(toolResult?.content).toContain("Morning brief");
    expect(result.nextSortOrder).toBe(4);
    expect(listAutomations()).toHaveLength(0);
  });

  it("rejects invalid schedules with an error tool result and creates no action", async () => {
    const { context, startedActions } = buildExecutorContext();

    const result = await executeCreateAutomationProposal(
      "call_auto_2",
      {
        name: "Too frequent",
        prompt: "Do things.",
        schedule_kind: "interval",
        interval_minutes: 2
      },
      context
    );

    expect(startedActions).toHaveLength(0);
    const toolResult = result.promptMessages.at(-1);
    expect(toolResult?.content).toContain("Error: Interval automations must be at least 5 minutes");
    expect(listAutomations()).toHaveLength(0);
  });

  it("rejects missing name or prompt", async () => {
    const { context, startedActions } = buildExecutorContext();

    const missingName = await executeCreateAutomationProposal(
      "call_auto_3",
      { prompt: "Do things.", schedule_kind: "interval", interval_minutes: 10 },
      context
    );
    const missingPrompt = await executeCreateAutomationProposal(
      "call_auto_4",
      { name: "No prompt", schedule_kind: "interval", interval_minutes: 10 },
      context
    );

    expect(missingName.promptMessages.at(-1)?.content).toContain("Error: name is required");
    expect(missingPrompt.promptMessages.at(-1)?.content).toContain("Error: prompt is required");
    expect(startedActions).toHaveLength(0);
  });

  it("rejects weekly schedules without weekdays", async () => {
    const { context, startedActions } = buildExecutorContext();

    const result = await executeCreateAutomationProposal(
      "call_auto_5",
      {
        name: "Weekly without days",
        prompt: "Do things.",
        schedule_kind: "calendar",
        calendar_frequency: "weekly",
        time_of_day: "09:00",
        days_of_week: []
      },
      context
    );

    expect(result.promptMessages.at(-1)?.content).toContain(
      "Error: Weekly automations require at least one weekday"
    );
    expect(startedActions).toHaveLength(0);
  });
});

describe("automation proposal approval helpers", () => {
  beforeEach(() => {
    registerProviderProfile();
    requireUserMock.mockReset();
  });

  it("approving creates a real automation owned by the approving user with nextRunAt set", async () => {
    const { user, message } = await createUserConversationFixture("auto-approve-owner");
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload()
    });

    const { action, automation } = approveAutomationProposal(created.id, undefined, user.id);

    expect(automation).toEqual(
      expect.objectContaining({
        name: "Morning brief",
        prompt: "Summarize today's priorities for {{date}}.",
        scheduleKind: "calendar",
        calendarFrequency: "daily",
        timeOfDay: "08:30",
        enabled: true,
        continuePreviousConversation: false,
        nextRunAt: expect.any(String)
      })
    );
    expect(listAutomations(user.id)).toEqual([expect.objectContaining({ id: automation.id })]);
    expect(action).toEqual(
      expect.objectContaining({
        id: created.id,
        status: "completed",
        resultSummary: "Approved",
        proposalState: "approved",
        proposalPayload: expect.objectContaining({ automationId: automation.id })
      })
    );
    expect(getMessage(message.id)?.actions?.[0]).toEqual(
      expect.objectContaining({ proposalState: "approved" })
    );
  });

  it("broadcasts a bot update when a bot-owned automation proposal is approved or dismissed", async () => {
    const { createBot } = await import("@/lib/bots");
    const { getConversationManager } = await import("@/lib/ws-singleton");
    const manager = getConversationManager();

    const events: Array<{ botId: string; waitingForInput: boolean }> = [];
    const original = manager.broadcastAll;
    manager.broadcastAll = (event: Parameters<typeof original>[0], _userId: string | null) => {
      if (event.type === "bot_updated") {
        events.push({ botId: event.bot.id, waitingForInput: event.bot.waitingForInput });
      }
    };

    try {
      const user = await createLocalUser({
        username: "auto-bot-broadcast",
        password: "Password123!",
        role: "user"
      });
      const bot = createBot({ name: "Automation Bot" }, user.id);
      const message = createMessage({
        conversationId: bot.homeConversationId,
        role: "assistant",
        content: "",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 0
      });
      const created = createMessageAction({
        messageId: message.id,
        kind: "create_automation",
        status: "pending",
        label: "Automation proposal",
        proposalState: "pending",
        proposalPayload: buildAutomationPayload()
      });

      dismissAutomationProposal(created.id, user.id);
      expect(events).toEqual([{ botId: bot.id, waitingForInput: false }]);

      const second = createMessageAction({
        messageId: message.id,
        kind: "create_automation",
        status: "pending",
        label: "Automation proposal",
        proposalState: "pending",
        proposalPayload: buildAutomationPayload({ name: "Evening brief" })
      });

      registerProviderProfile();
      approveAutomationProposal(second.id, undefined, user.id);
      expect(events).toEqual([
        { botId: bot.id, waitingForInput: false },
        { botId: bot.id, waitingForInput: false }
      ]);
    } finally {
      manager.broadcastAll = original;
    }
  });

  it("rejects approval from a different user and creates nothing", async () => {
    const owner = await createUserConversationFixture("auto-approve-owner-2");
    const other = await createLocalUser({
      username: "auto-approve-other-2",
      password: "Password123!",
      role: "user"
    });
    const created = createMessageAction({
      messageId: owner.message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload()
    });

    expect(() => approveAutomationProposal(created.id, undefined, other.id)).toThrow(
      "Automation proposal not found"
    );
    expect(listAutomations(owner.user.id)).toHaveLength(0);
    expect(listAutomations(other.id)).toHaveLength(0);
    expect(getMessageActionKind(created.id)).toBe("create_automation");
  });

  it("applies approval overrides and validates overridden schedules", async () => {
    const { user, message } = await createUserConversationFixture("auto-approve-overrides");
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload()
    });

    const { automation } = approveAutomationProposal(
      created.id,
      {
        name: "Renamed brief",
        prompt: "Rebuilt prompt.",
        scheduleKind: "interval",
        intervalMinutes: 30,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        continuePreviousConversation: true
      },
      user.id
    );

    expect(automation).toEqual(
      expect.objectContaining({
        name: "Renamed brief",
        prompt: "Rebuilt prompt.",
        scheduleKind: "interval",
        intervalMinutes: 30,
        continuePreviousConversation: true
      })
    );

    const second = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload({ name: "Second" })
    });

    expect(() =>
      approveAutomationProposal(
        second.id,
        { scheduleKind: "interval", intervalMinutes: 1 },
        user.id
      )
    ).toThrow("Interval automations must be at least 5 minutes");
    expect(listAutomations(user.id)).toHaveLength(1);
    expect(getMessage(message.id)?.actions?.find((a) => a.id === second.id)).toEqual(
      expect.objectContaining({ proposalState: "pending" })
    );
  });

  it("rejects approval when the provider profile disappeared", async () => {
    const { user, message } = await createUserConversationFixture("auto-approve-missing-profile");
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload({ providerProfileId: "profile_gone" })
    });

    expect(() => approveAutomationProposal(created.id, undefined, user.id)).toThrow(
      "Provider profile not found"
    );
    expect(listAutomations(user.id)).toHaveLength(0);
  });

  it("dismisses without creating an automation and rejects double actions", async () => {
    const { user, message } = await createUserConversationFixture("auto-dismiss");
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload()
    });

    const action = dismissAutomationProposal(created.id, user.id);

    expect(action).toEqual(
      expect.objectContaining({
        status: "completed",
        resultSummary: "Ignored",
        proposalState: "dismissed"
      })
    );
    expect(listAutomations(user.id)).toHaveLength(0);

    expect(() => approveAutomationProposal(created.id, undefined, user.id)).toThrow(
      "Automation proposal is no longer pending"
    );
    expect(() => dismissAutomationProposal(created.id, user.id)).toThrow(
      "Automation proposal is no longer pending"
    );
  });

  it("rejects malformed automation payloads", async () => {
    const { user, message } = await createUserConversationFixture("auto-broken-payload");
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: null
    });

    expect(() => approveAutomationProposal(created.id, undefined, user.id)).toThrow(
      "Automation proposal payload is missing"
    );
  });
});

describe("automation proposal approval routes", () => {
  beforeEach(() => {
    registerProviderProfile();
    requireUserMock.mockReset();
  });

  it("approves through the route and returns the created automation", async () => {
    const { user, message } = await createUserConversationFixture("auto-approve-route");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload({ prompt: "Draft prompt." })
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/approve/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Final prompt with {{date}}." })
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      action?: { id: string; proposalState: string };
      automation?: { id: string; prompt: string; nextRunAt: string | null };
    };
    expect(payload.action).toEqual(
      expect.objectContaining({ id: created.id, proposalState: "approved" })
    );
    expect(payload.automation).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        prompt: "Final prompt with {{date}}.",
        nextRunAt: expect.any(String)
      })
    );
    expect(listAutomations(user.id)).toHaveLength(1);
  });

  it("dismisses through the route without side effects", async () => {
    const { user, message } = await createUserConversationFixture("auto-dismiss-route");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload()
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/dismiss/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/dismiss`, {
        method: "POST"
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { action?: { proposalState: string } };
    expect(payload.action).toEqual(expect.objectContaining({ proposalState: "dismissed" }));
    expect(listAutomations(user.id)).toHaveLength(0);
  });

  it("rejects approving another user's automation proposal through the route", async () => {
    const owner = await createUserConversationFixture("auto-approve-cross-owner");
    const other = await createLocalUser({
      username: "auto-approve-cross-other",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(buildRouteUser(other.id));
    const created = createMessageAction({
      messageId: owner.message.id,
      kind: "create_automation",
      status: "pending",
      label: "Automation proposal",
      proposalState: "pending",
      proposalPayload: buildAutomationPayload()
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
    await expect(response.json()).resolves.toEqual({ error: "Automation proposal not found" });
    expect(listAutomations(owner.user.id)).toHaveLength(0);
  });

  it("rejects invalid automation override bodies", async () => {
    const { user } = await createUserConversationFixture("auto-approve-route-invalid");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));

    const { POST } = await import("@/app/api/message-actions/[actionId]/approve/route");
    const response = await POST(
      new Request("http://localhost/api/message-actions/act_bad/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervalMinutes: 1.5 })
      }),
      { params: Promise.resolve({ actionId: "act_bad" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid approval overrides" });
  });

  it("still approves memory proposals through the shared route", async () => {
    const { user, message } = await createUserConversationFixture("auto-route-memory-interop");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    const created = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: {
        operation: "create",
        targetMemoryId: null,
        proposedMemory: { content: "User likes automations", category: "preference" }
      }
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

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { action?: { proposalState: string }; automation?: unknown };
    expect(payload.action).toEqual(expect.objectContaining({ proposalState: "approved" }));
    expect(payload.automation).toBeUndefined();
  });
});

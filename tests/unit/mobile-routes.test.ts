import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as mobileDelete,
  GET as mobileGet,
  PATCH as mobilePatch,
  POST as mobilePost,
  PUT as mobilePut
} from "@/app/api/v1/[...path]/route";
import { createAutomationRun } from "@/lib/automations";
import { createMobileSession, verifyMobileSessionToken } from "@/lib/auth";
import { createConversation, createMessage } from "@/lib/conversations";
import { updateProviderCatalog } from "@/lib/settings";
import { createLocalUser } from "@/lib/users";
import { assertOpenApiResponse } from "@/tests/fixtures/mobile-contract-validator";
import { createProviderCatalogInput, createProviderProfileInput } from "@/tests/provider-fixtures";

async function assertResponseContract(
  pathname: string,
  method: string,
  response: Response
) {
  assertOpenApiResponse(pathname, method, response.status, await response.clone().json());
}

function buildProfile() {
  return createProviderProfileInput({
    id: "profile_mobile_routes",
    name: "Mobile routes provider",
    providerKind: "openai_compatible" as const,
    providerConfig: {
      apiBaseUrl: "https://api.example.com/v1",
      apiMode: "responses"
    },
    credentials: { apiKey: "sk-mobile-route-secret" },
    model: "gpt-mobile",
    systemPrompt: "Be exact."
  });
}

function request(
  path: string[],
  token: string,
  options: { method?: string; body?: unknown; query?: string } = {}
) {
  return new Request(
    `http://localhost/api/v1/${path.join("/")}${options.query ?? ""}`,
    {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    }
  );
}

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe("Mobile API v1 REST adapter", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("enforces bearer authentication, ownership, and administrator roles through shared handlers", async () => {
    const admin = await createLocalUser({
      username: "mobile-admin",
      password: "MobileAdminPassword123!",
      role: "admin"
    });
    const member = await createLocalUser({
      username: "mobile-member",
      password: "MobileMemberPassword123!",
      role: "user"
    });
    const adminSession = await createMobileSession(admin.id, "Admin phone");
    const memberSession = await createMobileSession(member.id, "Member phone");
    const adminConversation = createConversation("Admin private", null, {}, admin.id);
    const memberConversation = createConversation("Member private", null, {}, member.id);

    const missingAuth = await mobileGet(
      new Request("http://localhost/api/v1/conversations"),
      context(["conversations"])
    );
    expect(missingAuth.status).toBe(401);

    const memberList = await mobileGet(
      request(["conversations"], memberSession.token),
      context(["conversations"])
    );
    const memberListBody = await memberList.json() as {
      data: { conversations: Array<{ id: string }> };
    };
    expect(memberListBody.data.conversations.map((conversation) => conversation.id)).toEqual([
      memberConversation.id
    ]);

    const crossOwner = await mobileGet(
      request(["conversations", adminConversation.id], memberSession.token),
      context(["conversations", adminConversation.id])
    );
    expect(crossOwner.status).toBe(404);
    await expect(crossOwner.json()).resolves.toEqual({
      error: { code: "not_found", message: "Conversation not found" }
    });

    const memberUsers = await mobileGet(
      request(["users"], memberSession.token),
      context(["users"])
    );
    expect(memberUsers.status).toBe(403);

    const adminUsers = await mobileGet(
      request(["users"], adminSession.token),
      context(["users"])
    );
    expect(adminUsers.status).toBe(200);
    await assertResponseContract("/users", "get", adminUsers);
    expect(JSON.stringify(await adminUsers.json())).not.toContain("passwordHash");

    const resetPath = ["users", member.id];
    const resetPassword = await mobilePatch(
      request(resetPath, adminSession.token, {
        method: "PATCH",
        body: { password: "NewMobileMemberPassword123!" }
      }),
      context(resetPath)
    );
    expect(resetPassword.status).toBe(200);
    await assertResponseContract("/users/{userId}", "patch", resetPassword);
    await expect(verifyMobileSessionToken(memberSession.token)).resolves.toBeNull();
  });

  it("serves bot teammates and bot avatars through bearer-authenticated shared handlers", async () => {
    const member = await createLocalUser({
      username: "mobile-bot-member",
      password: "MobileBotPassword123!",
      role: "user"
    });
    const outsider = await createLocalUser({
      username: "mobile-bot-outsider",
      password: "MobileOutsiderPassword123!",
      role: "user"
    });
    const memberSession = await createMobileSession(member.id, "Bot phone");
    const outsiderSession = await createMobileSession(outsider.id, "Outsider phone");

    const missingAuth = await mobileGet(
      new Request("http://localhost/api/v1/bots"),
      context(["bots"])
    );
    expect(missingAuth.status).toBe(401);

    const roster = await mobileGet(request(["bots"], memberSession.token), context(["bots"]));
    expect(roster.status).toBe(200);
    await assertResponseContract("/bots", "get", roster);
    const rosterBody = await roster.json() as {
      data: {
        bots: Array<{ id: string; isChief: boolean }>;
        runs: unknown[];
        limits: { maxBots: number };
      };
    };
    expect(rosterBody.data.bots).toHaveLength(1);
    expect(rosterBody.data.bots[0].isChief).toBe(true);
    expect(rosterBody.data.limits.maxBots).toBeGreaterThan(0);
    const chiefId = rosterBody.data.bots[0].id;

    const created = await mobilePost(
      request(["bots"], memberSession.token, {
        method: "POST",
        body: { name: "Researcher", title: "Research", description: "Finds things" }
      }),
      context(["bots"])
    );
    expect(created.status).toBe(201);
    await assertResponseContract("/bots", "post", created);
    const botId = ((await created.json()) as { data: { bot: { id: string } } }).data.bot.id;

    const crossOwner = await mobileGet(
      request(["bots", botId], outsiderSession.token),
      context(["bots", botId])
    );
    expect(crossOwner.status).toBe(404);

    const detail = await mobileGet(
      request(["bots", botId], memberSession.token),
      context(["bots", botId])
    );
    expect(detail.status).toBe(200);
    await assertResponseContract("/bots/{botId}", "get", detail);

    const patched = await mobilePatch(
      request(["bots", botId], memberSession.token, {
        method: "PATCH",
        body: { title: "Deep research" }
      }),
      context(["bots", botId])
    );
    expect(patched.status).toBe(200);
    await assertResponseContract("/bots/{botId}", "patch", patched);

    const memories = await mobileGet(
      request(["bots", botId, "memories"], memberSession.token),
      context(["bots", botId, "memories"])
    );
    expect(memories.status).toBe(200);
    await assertResponseContract("/bots/{botId}/memories", "get", memories);
    await expect(memories.json()).resolves.toMatchObject({ data: { memories: [] } });

    const workspace = await mobileGet(
      request(["bots", botId, "workspace"], memberSession.token),
      context(["bots", botId, "workspace"])
    );
    expect(workspace.status).toBe(200);
    await assertResponseContract("/bots/{botId}/workspace", "get", workspace);
    const seenInput = await mobilePost(
      request(["bots", botId, "seen-input"], memberSession.token, { method: "POST" }),
      context(["bots", botId, "seen-input"])
    );
    expect(seenInput.status).toBe(200);
    await assertResponseContract("/bots/{botId}/seen-input", "post", seenInput);
    await expect(seenInput.json()).resolves.toMatchObject({ data: { bot: { id: botId } } });


    const emptySkills = await mobileGet(
      request(["bots", botId, "skills"], memberSession.token),
      context(["bots", botId, "skills"])
    );
    expect(emptySkills.status).toBe(200);
    await assertResponseContract("/bots/{botId}/skills", "get", emptySkills);
    await expect(emptySkills.json()).resolves.toMatchObject({ data: { skills: [] } });

    const createdSkill = await mobilePost(
      request(["bots", botId, "skills"], memberSession.token, {
        method: "POST",
        body: {
          name: "Weekly digest",
          description: "Summarize the week",
          instructions: "Summarize the week into five bullets."
        }
      }),
      context(["bots", botId, "skills"])
    );
    expect(createdSkill.status).toBe(201);
    await assertResponseContract("/bots/{botId}/skills", "post", createdSkill);
    const createdSkillBody = await createdSkill.json() as {
      data: { skill: { id: string; name: string } };
    };
    const skillId = createdSkillBody.data.skill.id;

    const patchedSkill = await mobilePatch(
      request(["bots", botId, "skills", skillId], memberSession.token, {
        method: "PATCH",
        body: { description: "Summarize the week for the team" }
      }),
      context(["bots", botId, "skills", skillId])
    );
    expect(patchedSkill.status).toBe(200);
    await assertResponseContract("/bots/{botId}/skills/{skillId}", "patch", patchedSkill);

    const outsiderSkills = await mobileGet(
      request(["bots", botId, "skills"], outsiderSession.token),
      context(["bots", botId, "skills"])
    );
    expect(outsiderSkills.status).toBe(404);

    const deletedSkill = await mobileDelete(
      request(["bots", botId, "skills", skillId], memberSession.token, { method: "DELETE" }),
      context(["bots", botId, "skills", skillId])
    );
    expect(deletedSkill.status).toBe(200);
    await assertResponseContract("/bots/{botId}/skills/{skillId}", "delete", deletedSkill);

    const chiefDelete = await mobileDelete(
      request(["bots", chiefId], memberSession.token, { method: "DELETE" }),
      context(["bots", chiefId])
    );
    expect(chiefDelete.status).toBe(400);

    const deleted = await mobileDelete(
      request(["bots", botId], memberSession.token, { method: "DELETE" }),
      context(["bots", botId])
    );
    expect(deleted.status).toBe(200);
    await assertResponseContract("/bots/{botId}", "delete", deleted);

    const invalidAvatar = await mobileGet(
      request(["avatars", "not_valid!!"], memberSession.token),
      context(["avatars", "not_valid!!"])
    );
    expect(invalidAvatar.status).toBe(400);

    const avatarNoAuth = await mobileGet(
      new Request("http://localhost/api/v1/avatars/seed_x.svg"),
      context(["avatars", "seed_x.svg"])
    );
    expect(avatarNoAuth.status).toBe(401);
  });

  it("saves and resets onboarding preferences through bearer-authenticated handlers", async () => {
    const member = await createLocalUser({
      username: "mobile-onboarding-member",
      password: "MobileOnboardingPassword123!",
      role: "user"
    });
    const memberSession = await createMobileSession(member.id, "Onboarding phone");

    const saved = await mobilePut(
      request(["onboarding"], memberSession.token, {
        method: "PUT",
        body: { defaultView: "agents", toolCallDisplay: "status_line", completed: true }
      }),
      context(["onboarding"])
    );
    expect(saved.status).toBe(200);
    await assertResponseContract("/onboarding", "put", saved);
    const savedBody = await saved.json() as {
      data: { settings: { defaultView: string; toolCallDisplay: string; hasCompletedOnboarding: boolean } };
    };
    expect(savedBody.data.settings.defaultView).toBe("agents");
    expect(savedBody.data.settings.toolCallDisplay).toBe("status_line");
    expect(savedBody.data.settings.hasCompletedOnboarding).toBe(true);

    const reset = await mobileDelete(
      request(["onboarding"], memberSession.token, { method: "DELETE" }),
      context(["onboarding"])
    );
    expect(reset.status).toBe(200);
    await assertResponseContract("/onboarding", "delete", reset);
    const resetBody = await reset.json() as {
      data: { settings: { hasCompletedOnboarding: boolean } };
    };
    expect(resetBody.data.settings.hasCompletedOnboarding).toBe(false);

    const invalid = await mobilePut(
      request(["onboarding"], memberSession.token, {
        method: "PUT",
        body: { defaultView: "nonsense" }
      }),
      context(["onboarding"])
    );
    expect(invalid.status).toBe(400);
  });

  it("normalizes shared route responses and redacts provider secrets", async () => {
    const admin = await createLocalUser({
      username: "settings-admin",
      password: "SettingsAdminPassword123!",
      role: "admin"
    });
    const session = await createMobileSession(admin.id, "Settings device");
    updateProviderCatalog(createProviderCatalogInput([buildProfile()]));

    const response = await mobileGet(
      request(["settings"], session.token),
      context(["settings"])
    );
    expect(response.status).toBe(200);
    await assertResponseContract("/settings", "get", response);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("Mobile routes provider");
    expect(serialized).toContain('"connection"');
    expect(serialized).toContain('"status":"connected"');
    expect(serialized).not.toContain("sk-mobile-route-secret");
    expect(serialized).not.toContain("apiKeyEncrypted");
  });

  it("conforms representative resource responses to the OpenAPI contract", async () => {
    const admin = await createLocalUser({
      username: "contract-admin",
      password: "ContractAdminPassword123!",
      role: "admin"
    });
    const session = await createMobileSession(admin.id, "Contract device");
    updateProviderCatalog(createProviderCatalogInput([buildProfile()]));

    const call = async (
      template: string,
      path: string[],
      method: "GET" | "POST" | "PATCH" | "DELETE",
      body?: unknown,
      query?: string
    ) => {
      const mobileRequest = request(path, session.token, { method, body, query });
      const routeContext = context(path);
      const response = method === "GET"
        ? await mobileGet(mobileRequest, routeContext)
        : method === "POST"
          ? await mobilePost(mobileRequest, routeContext)
          : method === "PATCH"
            ? await mobilePatch(mobileRequest, routeContext)
            : await mobileDelete(mobileRequest, routeContext);
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
      await assertResponseContract(template, method, response);
      return response.json() as Promise<Record<string, unknown>>;
    };

    const folderBody = await call("/folders", ["folders"], "POST", {
      name: "Contract folder"
    }) as { data: { folder: { id: string } } };
    await call("/folders", ["folders"], "GET");

    const conversationBody = await call("/conversations", ["conversations"], "POST", {
      title: "Contract conversation",
      folderId: folderBody.data.folder.id,
      providerProfileId: "profile_mobile_routes"
    }) as { data: { conversation: { id: string } } };
    const conversationId = conversationBody.data.conversation.id;
    await call("/conversations", ["conversations"], "GET");
    await call(
      "/conversations/search",
      ["conversations", "search"],
      "GET",
      undefined,
      "?q=Contract"
    );
    await call(
      "/conversations/{conversationId}",
      ["conversations", conversationId],
      "GET"
    );
    await call(
      "/conversations/{conversationId}/share",
      ["conversations", conversationId, "share"],
      "PATCH",
      { enabled: true }
    );

    const message = createMessage({
      conversationId,
      role: "user",
      content: "Original contract message"
    });
    await call(
      "/messages/{messageId}",
      ["messages", message.id],
      "PATCH",
      { content: "Updated contract message" }
    );

    const formData = new FormData();
    formData.set("conversationId", conversationId);
    formData.append(
      "files",
      new File(["contract attachment"], "contract.txt", { type: "text/plain" })
    );
    const attachmentPath = ["attachments"];
    const attachmentResponse = await mobilePost(
      new Request("http://localhost/api/v1/attachments", {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: formData
      }),
      context(attachmentPath)
    );
    expect(attachmentResponse.status).toBe(201);
    await assertResponseContract("/attachments", "post", attachmentResponse);
    const attachmentBody = await attachmentResponse.json() as {
      data: { attachments: Array<{ id: string }> };
    };
    await call(
      "/attachments/{attachmentId}",
      ["attachments", attachmentBody.data.attachments[0].id],
      "DELETE"
    );

    await call("/personas", ["personas"], "POST", {
      name: "Contract persona",
      content: "Answer precisely."
    });
    await call("/personas", ["personas"], "GET");

    await call("/memories", ["memories"], "POST", {
      content: "Contract memory",
      category: "work"
    });
    await call("/memories", ["memories"], "GET");

    const automationBody = await call("/automations", ["automations"], "POST", {
      name: "Contract automation",
      prompt: "Produce a contract report.",
      providerProfileId: "profile_mobile_routes",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 60,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: [],
      enabled: false
    }) as { data: { automation: { id: string } } };
    await call("/automations", ["automations"], "GET");
    await call(
      "/automations/{automationId}",
      ["automations", automationBody.data.automation.id],
      "GET"
    );
    const automationRun = createAutomationRun({
      automationId: automationBody.data.automation.id,
      scheduledFor: new Date().toISOString(),
      triggerSource: "manual_run"
    });
    await call(
      "/automations/{automationId}/runs",
      ["automations", automationBody.data.automation.id, "runs"],
      "GET"
    );
    await call(
      "/automation-runs/{runId}",
      ["automation-runs", automationRun.id],
      "GET"
    );

    await call("/mcp-servers", ["mcp-servers"], "POST", {
      transport: "streamable_http",
      name: "Contract MCP",
      url: "https://mcp.example.com",
      headers: { authorization: "Bearer secret" },
      enabled: false
    });
    await call("/mcp-servers", ["mcp-servers"], "GET");

    await call("/skills", ["skills"], "POST", {
      name: "Contract skill",
      description: "Contract fixture",
      content: "Use the contract.",
      enabled: true
    });
    await call("/skills", ["skills"], "GET");

    await call("/users", ["users"], "POST", {
      username: "contract-member",
      password: "ContractMemberPassword123!",
      role: "user"
    });
    await call("/users", ["users"], "GET");

    await call(
      "/conversations/{conversationId}",
      ["conversations", conversationId],
      "DELETE"
    );
  });

  it("provides queue CRUD, ordering, and send-now using the shared queue service", async () => {
    const member = await createLocalUser({
      username: "queue-member",
      password: "QueueMemberPassword123!",
      role: "user"
    });
    const session = await createMobileSession(member.id, "Queue device");
    const conversation = createConversation("Queue conversation", null, {}, member.id);
    const queuePath = ["conversations", conversation.id, "queue"];

    const firstResponse = await mobilePost(
      request(queuePath, session.token, {
        method: "POST",
        body: { content: "First", mode: "chat" }
      }),
      context(queuePath)
    );
    await assertResponseContract(
      "/conversations/{conversationId}/queue",
      "post",
      firstResponse
    );
    const first = await firstResponse.json() as { data: { queuedMessage: { id: string } } };
    const secondResponse = await mobilePost(
      request(queuePath, session.token, {
        method: "POST",
        body: { content: "Second", mode: "image" }
      }),
      context(queuePath)
    );
    await assertResponseContract(
      "/conversations/{conversationId}/queue",
      "post",
      secondResponse
    );
    const second = await secondResponse.json() as { data: { queuedMessage: { id: string } } };

    const orderPath = [...queuePath, "order"];
    const reorder = await mobilePut(
      request(orderPath, session.token, {
        method: "PUT",
        body: { queuedMessageIds: [second.data.queuedMessage.id, first.data.queuedMessage.id] }
      }),
      context(orderPath)
    );
    await assertResponseContract(
      "/conversations/{conversationId}/queue/order",
      "put",
      reorder
    );
    const reordered = await reorder.json() as {
      data: { queuedMessages: Array<{ id: string; sortOrder: number }> };
    };
    expect(reordered.data.queuedMessages.map((message) => message.id)).toEqual([
      second.data.queuedMessage.id,
      first.data.queuedMessage.id
    ]);
    expect(reordered.data.queuedMessages.map((message) => message.sortOrder)).toEqual([0, 1]);

    const sendNowPath = [...queuePath, first.data.queuedMessage.id, "send-now"];
    const sendNow = await mobilePost(
      request(sendNowPath, session.token, { method: "POST" }),
      context(sendNowPath)
    );
    expect(sendNow.status).toBe(200);
    await assertResponseContract(
      "/conversations/{conversationId}/queue/{queuedMessageId}/send-now",
      "post",
      sendNow
    );

    const deletePath = [...queuePath, second.data.queuedMessage.id];
    const deleted = await mobileDelete(
      request(deletePath, session.token, { method: "DELETE" }),
      context(deletePath)
    );
    expect(deleted.status).toBe(200);
    await assertResponseContract(
      "/conversations/{conversationId}/queue/{queuedMessageId}",
      "delete",
      deleted
    );

    const list = await mobileGet(request(queuePath, session.token), context(queuePath));
    await assertResponseContract(
      "/conversations/{conversationId}/queue",
      "get",
      list
    );
    const listBody = await list.json() as { data: { queuedMessages: Array<{ id: string }> } };
    expect(listBody.data.queuedMessages).toHaveLength(1);
  });

  it("bounds queued message content and request body size on the queue bridge", async () => {
    const member = await createLocalUser({
      username: "queue-limit-member",
      password: "QueueLimitPassword123!",
      role: "user"
    });
    const session = await createMobileSession(member.id, "Queue limit device");
    const conversation = createConversation("Queue limit conversation", null, {}, member.id);
    const queuePath = ["conversations", conversation.id, "queue"];
    const { MAX_CHAT_MESSAGE_CHARS } = await import("@/lib/constants");

    const oversizeContent = await mobilePost(
      request(queuePath, session.token, {
        method: "POST",
        body: { content: "a".repeat(MAX_CHAT_MESSAGE_CHARS + 1) }
      }),
      context(queuePath)
    );
    expect(oversizeContent.status).toBe(400);
    await expect(oversizeContent.json()).resolves.toEqual({
      error: expect.objectContaining({ message: "Invalid queued message payload" })
    });

    const oversizeBody = await mobilePost(
      request(queuePath, session.token, {
        method: "POST",
        body: { content: "hello", padding: "a".repeat(2 * 1024 * 1024) }
      }),
      context(queuePath)
    );
    expect(oversizeBody.status).toBe(413);
    await expect(oversizeBody.json()).resolves.toEqual({
      error: expect.objectContaining({ message: "Request body exceeds the 1 MB limit" })
    });
  });

  it("returns stable errors for invalid payloads, unsupported methods, and unknown operations", async () => {
    const user = await createLocalUser({
      username: "errors-member",
      password: "ErrorsMemberPassword123!",
      role: "user"
    });
    const session = await createMobileSession(user.id, "Errors device");
    const conversation = createConversation("Errors conversation", null, {}, user.id);
    const queuePath = ["conversations", conversation.id, "queue"];

    const invalidQueue = await mobilePost(
      request(queuePath, session.token, { method: "POST", body: { content: " " } }),
      context(queuePath)
    );
    expect(invalidQueue.status).toBe(400);

    const unsupported = await mobileDelete(
      request(["conversations"], session.token, { method: "DELETE" }),
      context(["conversations"])
    );
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toContain("GET");

    const missing = await mobileGet(
      request(["not-a-domain"], session.token),
      context(["not-a-domain"])
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: { code: "not_found", message: "Mobile API operation not found" }
    });
  });
});

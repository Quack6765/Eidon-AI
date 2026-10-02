import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as mobileDelete,
  GET as mobileGet,
  PATCH as mobilePatch,
  POST as mobilePost,
  PUT as mobilePut
} from "@/app/api/v1/[...path]/route";
import { GET as getServerInfo } from "@/app/api/v1/server-info/route";
import * as mobileLoginRoute from "@/app/api/v1/auth/login/route";
import * as mobileLogoutRoute from "@/app/api/v1/auth/logout/route";
import * as mobileSessionRoute from "@/app/api/v1/auth/session/route";
import * as mobileSessionsRoute from "@/app/api/v1/auth/sessions/route";
import * as mobileSessionRevokeRoute from "@/app/api/v1/auth/sessions/[sessionId]/route";
import { bindAttachmentsToMessage, createAttachments } from "@/lib/attachments";
import { createAutomationRun } from "@/lib/automations";
import { createBotRunRecord } from "@/lib/bot-runs";
import { getSharedBotWorkspaceDir, resolveBotSandbox } from "@/lib/bot-sandbox";
import { getBot } from "@/lib/bots";
import { createMobileSession, verifyMobileSessionToken } from "@/lib/auth";
import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { updateProviderCatalog } from "@/lib/settings";
import { createToolApprovalRules } from "@/lib/tool-approvals";
import { createLocalUser } from "@/lib/users";
import { assertOpenApiResponse } from "@/tests/fixtures/mobile-contract-validator";
import { createProviderCatalogInput, createProviderProfileInput } from "@/tests/provider-fixtures";

const openApiContractPath = path.join(process.cwd(), "contracts/mobile-api-v1.openapi.json");
const documentedOperations: string[] = (() => {
  const contract = JSON.parse(fs.readFileSync(openApiContractPath, "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
  return Object.entries(contract.paths).flatMap(([pathname, pathValue]) =>
    Object.keys(pathValue)
      .filter((key) => ["get", "post", "put", "patch", "delete"].includes(key))
      .map((method) => `${method.toUpperCase()} ${pathname}`)
  );
})();

async function assertResponseContract(
  pathname: string,
  method: string,
  response: Response
) {
  recordOperationCoverage(pathname, method);
  assertOpenApiResponse(pathname, method, response.status, await response.clone().json());
}

const coveredOperations = new Set<string>();

function recordOperationCoverage(pathname: string, method: string) {
  coveredOperations.add(`${method.toUpperCase()} ${pathname}`);
}

const operationsWithoutJsonConformance = new Map<string, string>([
  [
    "POST /conversations/{conversationId}/chat",
    "Streams server-sent events rather than a JSON body."
  ],
  [
    "POST /research/plan",
    "Drafts the plan with the configured model provider, so its 200 path cannot run in a unit test."
  ],
  [
    "POST /conversations/{conversationId}/research",
    "Drafts the plan with the configured model provider, so its 200 path cannot run in a unit test."
  ]
]);

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

function directRequest(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
) {
  return new Request(`http://localhost/api/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

async function callRoute(
  token: string,
  template: string,
  path: string[],
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  options: { body?: unknown; query?: string } = {}
) {
  const mobileRequest = request(path, token, {
    method,
    body: options.body,
    query: options.query
  });
  const routeContext = context(path);
  const response =
    method === "GET"
      ? await mobileGet(mobileRequest, routeContext)
      : method === "POST"
        ? await mobilePost(mobileRequest, routeContext)
        : method === "PUT"
          ? await mobilePut(mobileRequest, routeContext)
          : method === "PATCH"
            ? await mobilePatch(mobileRequest, routeContext)
            : await mobileDelete(mobileRequest, routeContext);
  await assertResponseContract(template, method, response);
  return response;
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
    const createdBot = ((await created.json()) as { data: { bot: { id: string; homeConversationId: string } } }).data.bot;
    const botId = createdBot.id;

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

    const workspaceBot = getBot(botId)!;
    fs.writeFileSync(path.join(resolveBotSandbox(workspaceBot).workspaceDir, "notes.md"), "# Notes");
    fs.writeFileSync(path.join(getSharedBotWorkspaceDir(workspaceBot), "handoff.bin"), Buffer.from([1, 2, 3]));

    const filePreview = await mobileGet(
      request(["bots", botId, "workspace", "file"], memberSession.token, { query: "?path=notes.md&format=text" }),
      context(["bots", botId, "workspace", "file"])
    );
    expect(filePreview.status).toBe(200);
    await assertResponseContract("/bots/{botId}/workspace/file", "get", filePreview);
    await expect(filePreview.json()).resolves.toEqual({
      data: { filename: "notes.md", mimeType: "text/markdown", content: "# Notes" }
    });

    const sharedDownload = await mobileGet(
      request(["bots", botId, "workspace", "file"], memberSession.token, {
        query: "?path=handoff.bin&scope=shared&download=1"
      }),
      context(["bots", botId, "workspace", "file"])
    );
    expect(sharedDownload.status).toBe(200);
    expect(sharedDownload.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await sharedDownload.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));

    const outsiderFile = await mobileGet(
      request(["bots", botId, "workspace", "file"], outsiderSession.token, { query: "?path=notes.md" }),
      context(["bots", botId, "workspace", "file"])
    );
    expect(outsiderFile.status).toBe(404);
    const read = await mobilePost(
      request(["bots", botId, "read"], memberSession.token, { method: "POST" }),
      context(["bots", botId, "read"])
    );
    expect(read.status).toBe(200);
    await assertResponseContract("/bots/{botId}/read", "post", read);
    await expect(read.json()).resolves.toMatchObject({ data: { bot: { id: botId, unread: false } } });

    const queuedRun = createBotRunRecord({
      botId,
      conversationId: createdBot.homeConversationId,
      triggerSource: "delegated"
    });
    const crossOwnerRunStop = await mobilePost(
      request(["bots", botId, "runs", queuedRun.id, "stop"], outsiderSession.token, { method: "POST" }),
      context(["bots", botId, "runs", queuedRun.id, "stop"])
    );
    expect(crossOwnerRunStop.status).toBe(404);
    const stoppedRun = await mobilePost(
      request(["bots", botId, "runs", queuedRun.id, "stop"], memberSession.token, { method: "POST" }),
      context(["bots", botId, "runs", queuedRun.id, "stop"])
    );
    expect(stoppedRun.status).toBe(200);
    await assertResponseContract("/bots/{botId}/runs/{runId}/stop", "post", stoppedRun);
    await expect(stoppedRun.json()).resolves.toMatchObject({ data: { run: { id: queuedRun.id, status: "stopped" } } });
    const stoppedBot = await mobilePost(
      request(["bots", botId, "stop"], memberSession.token, { method: "POST" }),
      context(["bots", botId, "stop"])
    );
    expect(stoppedBot.status).toBe(200);
    await assertResponseContract("/bots/{botId}/stop", "post", stoppedBot);
    await expect(stoppedBot.json()).resolves.toMatchObject({ data: { bot: { id: botId, status: "idle" } } });

    const approvalMessage = createMessage({
      conversationId: createdBot.homeConversationId,
      role: "assistant",
      content: ""
    });
    const approvalAction = createMessageAction({
      messageId: approvalMessage.id,
      kind: "tool_approval",
      status: "pending",
      label: 'Allow "git" commands?',
      detail: "git push",
      proposalState: "pending",
      proposalPayload: { operation: "tool_approval", scope: "shell", families: ["git"], classified: true, command: "git push" }
    });
    const pendingApprovals = await mobileGet(
      request(["bots", "approvals"], memberSession.token),
      context(["bots", "approvals"])
    );
    expect(pendingApprovals.status).toBe(200);
    await assertResponseContract("/bots/approvals", "get", pendingApprovals);
    await expect(pendingApprovals.json()).resolves.toMatchObject({
      data: {
        approvals: [
          {
            botId,
            botName: "Researcher",
            conversationId: createdBot.homeConversationId,
            action: { id: approvalAction.id, kind: "tool_approval", proposalState: "pending" }
          }
        ]
      }
    });
    const outsiderApprovals = await mobileGet(
      request(["bots", "approvals"], outsiderSession.token),
      context(["bots", "approvals"])
    );
    await expect(outsiderApprovals.json()).resolves.toEqual({ data: { approvals: [] } });
    const approved = await mobilePost(
      request(["message-actions", approvalAction.id, "approve"], memberSession.token, { method: "POST", body: {} }),
      context(["message-actions", approvalAction.id, "approve"])
    );
    expect(approved.status).toBe(200);
    const afterApproval = await mobileGet(
      request(["bots", "approvals"], memberSession.token),
      context(["bots", "approvals"])
    );
    await expect(afterApproval.json()).resolves.toEqual({ data: { approvals: [] } });

    const cleared = await mobilePost(
      request(["bots", botId, "clear-context"], memberSession.token, { method: "POST" }),
      context(["bots", botId, "clear-context"])
    );
    expect(cleared.status).toBe(200);
    await assertResponseContract("/bots/{botId}/clear-context", "post", cleared);
    await expect(cleared.json()).resolves.toMatchObject({
      data: { cleared: true, bot: { id: botId } }
    });


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

    const homeThreadDelete = await mobileDelete(
      request(["conversations", createdBot.homeConversationId], memberSession.token, { method: "DELETE" }),
      context(["conversations", createdBot.homeConversationId])
    );
    expect(homeThreadDelete.status).toBe(409);
    await assertResponseContract("/conversations/{conversationId}", "delete", homeThreadDelete);

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

  it("lists and revokes standing tool approval rules with contract-checked responses", async () => {
    const user = await createLocalUser({
      username: "tool-approvals-member",
      password: "ToolApprovalsPassword123!",
      role: "user"
    });
    const session = await createMobileSession(user.id, "Approvals phone");
    createToolApprovalRules(user.id, "shell", ["curl"]);

    const created = await mobilePost(
      request(["tool-approvals"], session.token, {
        method: "POST",
        body: { command: "git checkout" }
      }),
      context(["tool-approvals"])
    );
    expect(created.status).toBe(201);
    await assertResponseContract("/tool-approvals", "post", created);

    const toggled = await mobilePut(
      request(["tool-approvals"], session.token, {
        method: "PUT",
        body: { allowAll: true }
      }),
      context(["tool-approvals"])
    );
    expect(toggled.status).toBe(200);
    await assertResponseContract("/tool-approvals", "put", toggled);
    expect((await toggled.json()) as { data: { allowAll: boolean } }).toEqual({
      data: { allowAll: true }
    });

    const list = await mobileGet(
      request(["tool-approvals"], session.token),
      context(["tool-approvals"])
    );
    expect(list.status).toBe(200);
    await assertResponseContract("/tool-approvals", "get", list);
    const listBody = (await list.json()) as {
      data: { rules: Array<{ id: string; scope: string; family: string }> };
    };
    expect(listBody.data.rules).toHaveLength(2);
    expect(listBody.data.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "shell", family: "curl" }),
        expect.objectContaining({ scope: "shell", family: "git checkout" })
      ])
    );

    const ruleId = listBody.data.rules[0].id;
    const revoked = await mobileDelete(
      request(["tool-approvals", ruleId], session.token, { method: "DELETE" }),
      context(["tool-approvals", ruleId])
    );
    expect(revoked.status).toBe(200);
    await assertResponseContract("/tool-approvals/{ruleId}", "delete", revoked);

    const missing = await mobileDelete(
      request(["tool-approvals", ruleId], session.token, { method: "DELETE" }),
      context(["tool-approvals", ruleId])
    );
    expect(missing.status).toBe(404);
    await assertResponseContract("/tool-approvals/{ruleId}", "delete", missing);
  });

  it("exposes per-profile reasoning control and rejects unsupported reasoning efforts", async () => {
    const admin = await createLocalUser({
      username: "reasoning-admin",
      password: "ReasoningAdminPassword123!",
      role: "admin"
    });
    const session = await createMobileSession(admin.id, "Reasoning device");
    const glm = createProviderProfileInput({
      id: "profile_glm",
      name: "GLM",
      model: "glm-5.1",
      providerConfig: {
        apiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
        apiMode: "chat_completions"
      },
      credentials: { apiKey: "sk-glm" }
    });
    const deepSeek = createProviderProfileInput({
      id: "profile_deepseek",
      name: "DeepSeek",
      model: "deepseek-v4-flash",
      reasoningEffort: "none",
      providerConfig: { apiMode: "chat_completions" },
      credentials: { apiKey: "sk-deepseek" }
    });
    updateProviderCatalog(createProviderCatalogInput([glm, deepSeek]));

    const settings = await mobileGet(request(["settings"], session.token), context(["settings"]));
    expect(settings.status).toBe(200);
    await assertResponseContract("/settings", "get", settings);
    const { data } = await settings.json() as {
      data: { settings: { providerProfiles: Array<Record<string, unknown>> } };
    };
    const profiles = data.settings.providerProfiles;
    expect(profiles.find((profile) => profile.id === glm.id)).toMatchObject({
      reasoningControl: "levels",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"]
    });
    expect(profiles.find((profile) => profile.id === deepSeek.id)).toMatchObject({
      reasoningControl: "toggle",
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh"]
    });

    const rejected = await mobilePut(
      request(["settings", "providers"], session.token, {
        method: "PUT",
        body: createProviderCatalogInput([{ ...glm, reasoningEffort: "none" }, deepSeek])
      }),
      context(["settings", "providers"])
    );
    expect(rejected.status).toBe(400);
    await assertResponseContract("/settings/providers", "put", rejected);
    await expect(rejected.json()).resolves.toMatchObject({
      error: {
        code: "invalid_request",
        message: expect.stringContaining('Reasoning effort "none" is not supported by model "glm-5.1"')
      }
    });
    const unchanged = await mobileGet(request(["settings"], session.token), context(["settings"]));
    const { data: after } = await unchanged.json() as {
      data: { settings: { providerProfiles: Array<{ id: string; reasoningEffort: string }> } };
    };
    expect(
      after.settings.providerProfiles.find((profile) => profile.id === glm.id)?.reasoningEffort
    ).toBe(glm.reasoningEffort);
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
    const computerBody = await call(
      "/conversations/{conversationId}/computer",
      ["conversations", conversationId, "computer"],
      "GET"
    ) as { data: { computer: Record<string, unknown> } };
    expect(computerBody.data.computer).toEqual({ live: false, controlOwner: "bot", url: null, caption: null, viewport: null });
    const takenBody = await call(
      "/conversations/{conversationId}/computer/control",
      ["conversations", conversationId, "computer", "control"],
      "POST",
      { action: "take" }
    ) as { data: { computer: { controlOwner: string } } };
    expect(takenBody.data.computer.controlOwner).toBe("user");
    const returnedBody = await call(
      "/conversations/{conversationId}/computer/control",
      ["conversations", conversationId, "computer", "control"],
      "POST",
      { action: "return", note: "Signed in" }
    ) as { data: { computer: { controlOwner: string } } };
    expect(returnedBody.data.computer.controlOwner).toBe("bot");

    const { saveLogin } = await import("@/lib/saved-logins");
    saveLogin(admin.id, "https://example.com", "password", "contract-secret-value");
    const loginsBody = await call("/saved-logins", ["saved-logins"], "GET") as {
      data: { savedLogins: Array<{ id: string; origin: string; label: string }> };
    };
    expect(loginsBody.data.savedLogins).toEqual([expect.objectContaining({ origin: "https://example.com", label: "password" })]);
    expect(JSON.stringify(loginsBody)).not.toContain("contract-secret-value");
    await call("/saved-logins/{loginId}", ["saved-logins", loginsBody.data.savedLogins[0].id], "DELETE");

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
    const reply = createMessage({
      conversationId,
      role: "assistant",
      content: "Contract reply"
    });
    const [draftAttachment] = await createAttachments(conversationId, [
      { filename: "draft.txt", mimeType: "text/plain", bytes: Buffer.from("draft attachment", "utf8") }
    ]);
    bindAttachmentsToMessage(conversationId, message.id, [draftAttachment.id]);
    const userForkBody = await call(
      "/messages/{messageId}/fork",
      ["messages", message.id, "fork"],
      "POST"
    ) as { data: { draft: { content: string; attachments: Array<Record<string, unknown>> } } };
    expect(userForkBody.data.draft.content).toBe("Updated contract message");
    expect(userForkBody.data.draft.attachments[0]).not.toHaveProperty("relativePath");
    await call("/messages/{messageId}/fork", ["messages", reply.id, "fork"], "POST");
    const rewindBody = await call(
      "/messages/{messageId}/rewind",
      ["messages", message.id, "rewind"],
      "POST"
    ) as { data: { messages: unknown[]; draft: { attachments: Array<{ id: string; messageId: string | null }> } } };
    expect(rewindBody.data.messages).toEqual([]);
    expect(rewindBody.data.draft.attachments).toEqual([
      expect.objectContaining({ id: draftAttachment.id, messageId: null })
    ]);

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

  it("serves release highlights to native clients and records the version they acknowledged", async () => {
    const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    const { getNewestReleaseNote } = await import("@/lib/release-highlights");
    const newest = getNewestReleaseNote()!;
    process.env.NEXT_PUBLIC_APP_VERSION = newest.version;

    try {
      const member = await createLocalUser({
        username: "mobile-release-member",
        password: "MobileReleasePassword123!",
        role: "user"
      });
      const session = await createMobileSession(member.id, "Member phone");
      const { getDb } = await import("@/lib/db");
      getDb()
        .prepare("UPDATE user_preferences SET last_seen_release = ? WHERE user_id = ?")
        .run("", member.id);

      const highlights = await mobileGet(
        request(["whats-new"], session.token),
        context(["whats-new"])
      );
      expect(highlights.status).toBe(200);
      await assertResponseContract("/whats-new", "get", highlights);
      await expect(highlights.json()).resolves.toEqual({
        data: { whatsNew: { version: newest.version, autoOpen: true, bullets: newest.bullets } }
      });

      const acknowledged = await mobilePost(
        request(["whats-new"], session.token, { method: "POST" }),
        context(["whats-new"])
      );
      expect(acknowledged.status).toBe(200);
      await assertResponseContract("/whats-new", "post", acknowledged);
      await expect(acknowledged.json()).resolves.toEqual({
        data: { seenReleaseVersion: newest.version }
      });

      const afterAcknowledgement = await mobileGet(
        request(["whats-new"], session.token),
        context(["whats-new"])
      );
      expect(afterAcknowledgement.status).toBe(200);
      await assertResponseContract("/whats-new", "get", afterAcknowledgement);
      await expect(afterAcknowledgement.json()).resolves.toMatchObject({
        data: { whatsNew: { version: newest.version, autoOpen: false } }
      });
    } finally {
      if (originalVersion === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
      else process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
    }
  });

  it("conforms the newly exposed research, composer, skill, push and settings operations", async () => {
    const admin = await createLocalUser({
      username: "new-surface-admin",
      password: "NewSurfaceAdminPassword123!",
      role: "admin"
    });
    const member = await createLocalUser({
      username: "new-surface-member",
      password: "NewSurfaceMemberPassword123!",
      role: "user"
    });
    const adminSession = await createMobileSession(admin.id, "New surface admin device");
    const memberSession = await createMobileSession(member.id, "New surface member device");
    updateProviderCatalog(createProviderCatalogInput([buildProfile()]));

    const conversation = createConversation("New surface conversation", null, {}, admin.id);

    const composer = await callRoute(
      adminSession.token,
      "/composer/references",
      ["composer", "references"],
      "GET",
      { query: `?conversationId=${conversation.id}` }
    );
    expect(composer.status).toBe(200);
    await expect(composer.json()).resolves.toMatchObject({
      data: { bots: [], skills: expect.any(Array) }
    });

    const cancelledMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Prepare a research turn"
    });
    const cancelled = await callRoute(
      adminSession.token,
      "/conversations/{conversationId}/research",
      ["conversations", conversation.id, "research"],
      "DELETE",
      { body: { userMessageId: cancelledMessage.id } }
    );
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toEqual({ data: { deleted: true } });

    const researchMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Run the deep research turn"
    });
    const researchStarted = await callRoute(
      adminSession.token,
      "/conversations/{conversationId}/research",
      ["conversations", conversation.id, "research"],
      "PUT",
      { body: { userMessageId: researchMessage.id, plan: ["Survey the sources"] } }
    );
    expect(researchStarted.status).toBe(200);
    await expect(researchStarted.json()).resolves.toEqual({ data: { started: true } });

    const curatorConfig = await callRoute(
      adminSession.token,
      "/skills/maintenance",
      ["skills", "maintenance"],
      "GET"
    );
    expect(curatorConfig.status).toBe(200);
    expect(
      ((await curatorConfig.json()) as { data: { config: { staleAfterDays: number } } }).data.config
        .staleAfterDays
    ).toBeGreaterThan(0);

    const updatedCuratorConfig = await callRoute(
      adminSession.token,
      "/skills/maintenance",
      ["skills", "maintenance"],
      "PUT",
      { body: { staleAfterDays: 21 } }
    );
    expect(updatedCuratorConfig.status).toBe(200);
    await expect(updatedCuratorConfig.json()).resolves.toMatchObject({
      data: { config: { staleAfterDays: 21 } }
    });

    const createdBot = await callRoute(adminSession.token, "/bots", ["bots"], "POST", {
      body: { name: "Curator", title: "Library", description: "Keeps the skill library tidy" }
    });
    const botId = ((await createdBot.json()) as { data: { bot: { id: string } } }).data.bot.id;

    const botMaintenance = await callRoute(
      adminSession.token,
      "/bots/{botId}/skills/maintenance",
      ["bots", botId, "skills", "maintenance"],
      "GET"
    );
    expect(botMaintenance.status).toBe(200);
    await expect(botMaintenance.json()).resolves.toMatchObject({
      data: { archived: [], state: { paused: false } }
    });

    const paused = await callRoute(
      adminSession.token,
      "/bots/{botId}/skills/maintenance",
      ["bots", botId, "skills", "maintenance"],
      "POST",
      { body: { op: "pause" } }
    );
    await expect(paused.json()).resolves.toEqual({ data: { paused: true } });

    const resumed = await callRoute(
      adminSession.token,
      "/bots/{botId}/skills/maintenance",
      ["bots", botId, "skills", "maintenance"],
      "POST",
      { body: { op: "resume" } }
    );
    await expect(resumed.json()).resolves.toEqual({ data: { paused: false } });

    const missingSkill = await callRoute(
      adminSession.token,
      "/bots/{botId}/skills/maintenance",
      ["bots", botId, "skills", "maintenance"],
      "POST",
      { body: { op: "pin", ref: "skill_missing" } }
    );
    expect(missingSkill.status).toBe(404);

    const ledger = await callRoute(
      adminSession.token,
      "/skills/curator/ledger",
      ["skills", "curator", "ledger"],
      "GET",
      { query: `?botId=${botId}` }
    );
    expect(ledger.status).toBe(200);

    const purge = await callRoute(
      adminSession.token,
      "/skills/curator/purge",
      ["skills", "curator", "purge"],
      "POST",
      { body: { botId } }
    );
    expect(purge.status).toBe(400);

    const snapshots = await callRoute(
      adminSession.token,
      "/skills/curator/rollback",
      ["skills", "curator", "rollback"],
      "GET",
      { query: `?botId=${botId}` }
    );
    expect(snapshots.status).toBe(200);
    await expect(snapshots.json()).resolves.toEqual({ data: { snapshots: [] } });

    const rollback = await callRoute(
      adminSession.token,
      "/skills/curator/rollback",
      ["skills", "curator", "rollback"],
      "POST",
      { body: { botId, snapshot: "missing-snapshot" } }
    );
    expect(rollback.status).toBe(400);

    const vapid = await callRoute(adminSession.token, "/push/vapid", ["push", "vapid"], "GET");
    expect(vapid.status).toBe(200);
    expect(typeof ((await vapid.json()) as { data: { publicKey: string } }).data.publicKey).toBe(
      "string"
    );

    const subscriptions = await callRoute(
      adminSession.token,
      "/push/subscribe",
      ["push", "subscribe"],
      "GET"
    );
    await expect(subscriptions.json()).resolves.toEqual({ data: { subscriptions: [] } });

    const subscribed = await callRoute(
      adminSession.token,
      "/push/subscribe",
      ["push", "subscribe"],
      "POST",
      {
        body: {
          endpoint: "https://push.example.com/subscription",
          keys: { p256dh: "public-key", auth: "auth-secret" }
        }
      }
    );
    expect(subscribed.status).toBe(201);
    await expect(subscribed.json()).resolves.toMatchObject({
      data: { subscription: { endpoint: "https://push.example.com/subscription" } }
    });

    const unsubscribed = await callRoute(
      adminSession.token,
      "/push/subscribe",
      ["push", "subscribe"],
      "DELETE",
      { body: { endpoint: "https://push.example.com/subscription" } }
    );
    expect(unsubscribed.status).toBe(200);

    const pushoverStatus = await callRoute(adminSession.token, "/pushover", ["pushover"], "GET");
    await expect(pushoverStatus.json()).resolves.toEqual({ data: { configured: false } });

    const savedPushover = await callRoute(adminSession.token, "/pushover", ["pushover"], "PUT", {
      body: { userKey: "pushover-user-key", appToken: "pushover-app-token" }
    });
    expect(savedPushover.status).toBe(200);
    await expect(savedPushover.json()).resolves.toEqual({ data: { configured: true } });

    const clearedPushover = await callRoute(
      adminSession.token,
      "/pushover",
      ["pushover"],
      "DELETE"
    );
    await expect(clearedPushover.json()).resolves.toEqual({ data: { configured: false } });

    const semanticStatus = await callRoute(
      adminSession.token,
      "/settings/semantic-recall",
      ["settings", "semantic-recall"],
      "GET"
    );
    expect(semanticStatus.status).toBe(200);
    await expect(semanticStatus.json()).resolves.toMatchObject({
      data: { status: { enabled: expect.any(Boolean), modelId: expect.any(String) } }
    });

    const forbiddenRebuild = await callRoute(
      memberSession.token,
      "/settings/semantic-recall",
      ["settings", "semantic-recall"],
      "POST"
    );
    expect(forbiddenRebuild.status).toBe(403);

    const createdServer = await callRoute(adminSession.token, "/mcp-servers", ["mcp-servers"], "POST", {
      body: { transport: "stdio", name: "New surface MCP", command: "node" }
    });
    const serverId = ((await createdServer.json()) as { data: { server: { id: string } } }).data.server.id;

    const oauthFlows = await callRoute(
      adminSession.token,
      "/mcp-servers/{serverId}/oauth/flows",
      ["mcp-servers", serverId, "oauth", "flows"],
      "POST"
    );
    expect(oauthFlows.status).toBe(400);

    const oauthDisconnect = await callRoute(
      adminSession.token,
      "/mcp-servers/{serverId}/oauth",
      ["mcp-servers", serverId, "oauth"],
      "DELETE"
    );
    expect(oauthDisconnect.status).toBe(200);
    await expect(oauthDisconnect.json()).resolves.toEqual({ data: { success: true } });
  });

  it("conforms the remaining documented operations to the OpenAPI contract", async () => {
    const admin = await createLocalUser({
      username: "coverage-admin",
      password: "CoverageAdminPassword123!",
      role: "admin"
    });
    const session = await createMobileSession(admin.id, "Coverage device");
    updateProviderCatalog(createProviderCatalogInput([buildProfile()]));

    const serverInfo = await getServerInfo();
    expect(serverInfo.status).toBe(200);
    await assertResponseContract("/server-info", "get", serverInfo);

    const loginResponse = await mobileLoginRoute.POST(
      directRequest("auth/login", {
        method: "POST",
        body: {
          username: "coverage-admin",
          password: "CoverageAdminPassword123!",
          deviceName: "Coverage login"
        }
      })
    );
    expect(loginResponse.status).toBe(201);
    await assertResponseContract("/auth/login", "post", loginResponse);
    const loginToken = ((await loginResponse.json()) as { data: { accessToken: string } }).data
      .accessToken;

    const sessionResponse = await mobileSessionRoute.GET(
      directRequest("auth/session", { token: loginToken })
    );
    expect(sessionResponse.status).toBe(200);
    await assertResponseContract("/auth/session", "get", sessionResponse);

    const sessionsResponse = await mobileSessionsRoute.GET(
      directRequest("auth/sessions", { token: loginToken })
    );
    expect(sessionsResponse.status).toBe(200);
    await assertResponseContract("/auth/sessions", "get", sessionsResponse);

    const revocableSession = await createMobileSession(admin.id, "Coverage revocable device");
    const revoked = await mobileSessionRevokeRoute.DELETE(
      directRequest("auth/sessions/session_x", { method: "DELETE", token: loginToken }),
      { params: Promise.resolve({ sessionId: "session_x" }) }
    );
    expect(revoked.status).toBe(404);
    await assertResponseContract("/auth/sessions/{sessionId}", "delete", revoked);

    const reallyRevoked = await mobileSessionRevokeRoute.DELETE(
      directRequest(`auth/sessions/${revocableSession.sessionId}`, {
        method: "DELETE",
        token: loginToken
      }),
      { params: Promise.resolve({ sessionId: revocableSession.sessionId }) }
    );
    expect(reallyRevoked.status).toBe(200);
    await assertResponseContract("/auth/sessions/{sessionId}", "delete", reallyRevoked);

    const accountUpdate = await callRoute(session.token, "/auth/account", ["auth", "account"], "PUT", {
      body: { username: "coverage-admin", currentPassword: "CoverageAdminPassword123!" }
    });
    expect(accountUpdate.status).toBe(200);

    const logoutResponse = await mobileLogoutRoute.POST(
      directRequest("auth/logout", { method: "POST", token: loginToken })
    );
    expect(logoutResponse.status).toBe(200);
    await assertResponseContract("/auth/logout", "post", logoutResponse);

    const folder = await callRoute(session.token, "/folders", ["folders"], "POST", {
      body: { name: "Coverage folder" }
    });
    const folderId = ((await folder.json()) as { data: { folder: { id: string } } }).data.folder.id;

    await callRoute(session.token, "/folders", ["folders"], "PUT", { body: [folderId] });
    await callRoute(session.token, "/folders/{folderId}", ["folders", folderId], "PATCH", {
      body: { name: "Renamed coverage folder" }
    });

    const conversation = await callRoute(session.token, "/conversations", ["conversations"], "POST", {
      body: { title: "Coverage conversation", folderId }
    });
    const conversationId = ((await conversation.json()) as {
      data: { conversation: { id: string } };
    }).data.conversation.id;

    await callRoute(session.token, "/conversations", ["conversations"], "PUT", {
      body: [{ id: conversationId, folderId }]
    });
    await callRoute(session.token, "/conversations/{conversationId}", ["conversations", conversationId], "PATCH", {
      body: { title: "Renamed coverage conversation" }
    });
    await callRoute(
      session.token,
      "/conversations/{conversationId}/share",
      ["conversations", conversationId, "share"],
      "GET"
    );
    await callRoute(
      session.token,
      "/conversations/{conversationId}/stop",
      ["conversations", conversationId, "stop"],
      "POST"
    );

    const queued = await callRoute(
      session.token,
      "/conversations/{conversationId}/queue",
      ["conversations", conversationId, "queue"],
      "POST",
      { body: { content: "Queued coverage message" } }
    );
    const queuedMessageId = ((await queued.json()) as {
      data: { queuedMessage: { id: string } };
    }).data.queuedMessage.id;
    const patchedQueued = await callRoute(
      session.token,
      "/conversations/{conversationId}/queue/{queuedMessageId}",
      ["conversations", conversationId, "queue", queuedMessageId],
      "PATCH",
      { body: { content: "Edited queued coverage message" } }
    );
    expect(patchedQueued.status).toBe(200);

    const [textAttachment] = await createAttachments(conversationId, [
      {
        filename: "coverage.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("Coverage preview body", "utf8")
      }
    ]);
    const preview = await callRoute(
      session.token,
      "/attachments/{attachmentId}",
      ["attachments", textAttachment.id],
      "GET",
      { query: "?format=text" }
    );
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toEqual({
      data: {
        id: textAttachment.id,
        filename: "coverage.txt",
        mimeType: "text/plain",
        content: "Coverage preview body"
      }
    });

    const persona = await callRoute(session.token, "/personas", ["personas"], "POST", {
      body: { name: "Coverage persona", content: "Answer briefly." }
    });
    const personaId = ((await persona.json()) as { data: { persona: { id: string } } }).data.persona
      .id;
    await callRoute(session.token, "/personas/{personaId}", ["personas", personaId], "PATCH", {
      body: { name: "Renamed coverage persona" }
    });
    await callRoute(session.token, "/personas/{personaId}", ["personas", personaId], "DELETE");

    const memory = await callRoute(session.token, "/memories", ["memories"], "POST", {
      body: { content: "Coverage memory", category: "work" }
    });
    const memoryId = ((await memory.json()) as { data: { memory: { id: string } } }).data.memory.id;
    await callRoute(session.token, "/memories/{memoryId}", ["memories", memoryId], "PATCH", {
      body: { pinned: true }
    });
    await callRoute(session.token, "/memories/{memoryId}", ["memories", memoryId], "DELETE");

    const automation = await callRoute(session.token, "/automations", ["automations"], "POST", {
      body: {
        name: "Coverage automation",
        prompt: "Produce a coverage report.",
        providerProfileId: "profile_mobile_routes",
        personaId: null,
        scheduleKind: "interval",
        intervalMinutes: 60,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        enabled: false
      }
    });
    const automationId = ((await automation.json()) as {
      data: { automation: { id: string } };
    }).data.automation.id;
    await callRoute(
      session.token,
      "/automations/{automationId}",
      ["automations", automationId],
      "PATCH",
      { body: { name: "Renamed coverage automation" } }
    );
    await callRoute(
      session.token,
      "/automations/{automationId}/run-now",
      ["automations", automationId, "run-now"],
      "POST"
    );
    const automationRun = createAutomationRun({
      automationId,
      scheduledFor: new Date().toISOString(),
      triggerSource: "manual_run"
    });
    const retriedRun = await callRoute(
      session.token,
      "/automation-runs/{runId}/retry",
      ["automation-runs", automationRun.id, "retry"],
      "POST"
    );
    expect(retriedRun.status).toBe(400);
    await callRoute(
      session.token,
      "/automations/{automationId}",
      ["automations", automationId],
      "DELETE"
    );

    const retryConversation = createConversation("Coverage retry conversation", null, {}, admin.id);
    createMessage({ conversationId: retryConversation.id, role: "user", content: "Retry this" });
    const erroredReply = createMessage({
      conversationId: retryConversation.id,
      role: "assistant",
      content: "",
      status: "error"
    });
    await callRoute(
      session.token,
      "/messages/{messageId}/retry",
      ["messages", erroredReply.id, "retry"],
      "POST"
    );

    const regenerateConversation = createConversation(
      "Coverage regenerate conversation",
      null,
      {},
      admin.id
    );
    const regeneratedMessage = createMessage({
      conversationId: regenerateConversation.id,
      role: "user",
      content: "Regenerate this"
    });
    await callRoute(
      session.token,
      "/messages/{messageId}/regenerate",
      ["messages", regeneratedMessage.id, "regenerate"],
      "POST"
    );

    const editConversation = createConversation("Coverage edit conversation", null, {}, admin.id);
    const editedMessage = createMessage({
      conversationId: editConversation.id,
      role: "user",
      content: "Edit this"
    });
    await callRoute(
      session.token,
      "/messages/{messageId}/edit-restart",
      ["messages", editedMessage.id, "edit-restart"],
      "POST",
      { body: { content: "Edited coverage message" } }
    );

    const actionMessage = createMessage({ conversationId, role: "assistant", content: "" });
    const approvalAction = createMessageAction({
      messageId: actionMessage.id,
      kind: "tool_approval",
      status: "pending",
      label: 'Allow "git" commands?',
      detail: "git push",
      proposalState: "pending",
      proposalPayload: {
        operation: "tool_approval",
        scope: "shell",
        families: ["git"],
        classified: true,
        command: "git push"
      }
    });
    await callRoute(
      session.token,
      "/message-actions/{actionId}/approve",
      ["message-actions", approvalAction.id, "approve"],
      "POST",
      { body: {} }
    );
    const dismissAction = createMessageAction({
      messageId: actionMessage.id,
      kind: "create_memory",
      status: "pending",
      label: "Remember the preference",
      detail: "Prefers short answers",
      proposalState: "pending",
      proposalPayload: { operation: "create", targetMemoryId: null }
    });
    await callRoute(
      session.token,
      "/message-actions/{actionId}/dismiss",
      ["message-actions", dismissAction.id, "dismiss"],
      "POST"
    );
    const secretAction = createMessageAction({
      messageId: actionMessage.id,
      kind: "secret_request",
      status: "pending",
      label: "Sign in to Example",
      detail: "https://example.com",
      proposalState: "pending",
      proposalPayload: {
        operation: "secret_request",
        label: "Password",
        origin: "https://example.com",
        target: "input#password",
        save: false
      }
    });
    const filledSecret = await callRoute(
      session.token,
      "/message-actions/{actionId}/secret",
      ["message-actions", secretAction.id, "secret"],
      "POST",
      { body: { value: "coverage-secret-value" } }
    );
    expect([200, 409]).toContain(filledSecret.status);

    await callRoute(session.token, "/settings/general", ["settings", "general"], "PUT", {
      body: { preferences: { toolCallDisplay: "status_line" } }
    });
    await callRoute(
      session.token,
      "/settings/providers/duplicate",
      ["settings", "providers", "duplicate"],
      "POST",
      { body: { sourceProfileId: "profile_mobile_routes" } }
    );
    await callRoute(
      session.token,
      "/settings/title-generation",
      ["settings", "title-generation"],
      "PUT",
      { body: { titleGenerationMode: "same", titleGenerationProfileId: null } }
    );
    const settingsTest = await callRoute(
      session.token,
      "/settings/test",
      ["settings", "test"],
      "POST",
      { body: { providerProfileId: "profile_absent" } }
    );
    expect([400, 502]).toContain(settingsTest.status);

    await callRoute(
      session.token,
      "/speech/transcription/prepare",
      ["speech", "transcription", "prepare"],
      "POST"
    );
    await callRoute(
      session.token,
      "/speech/transcription/transcribe",
      ["speech", "transcription", "transcribe"],
      "POST"
    );
    await callRoute(
      session.token,
      "/speech/transcription/cleanup",
      ["speech", "transcription", "cleanup"],
      "POST",
      { body: { transcript: "Coverage transcript" } }
    );

    const mcpServer = await callRoute(session.token, "/mcp-servers", ["mcp-servers"], "POST", {
      body: { transport: "stdio", name: "Coverage MCP", command: "node" }
    });
    const mcpServerId = ((await mcpServer.json()) as {
      data: { server: { id: string } };
    }).data.server.id;
    await callRoute(
      session.token,
      "/mcp-servers/{serverId}",
      ["mcp-servers", mcpServerId],
      "PATCH",
      { body: { name: "Renamed coverage MCP" } }
    );
    const unknownMcpTest = await callRoute(
      session.token,
      "/mcp-servers/test",
      ["mcp-servers", "test"],
      "POST",
      { body: { serverId: "server_missing" } }
    );
    expect(unknownMcpTest.status).toBe(404);
    await callRoute(
      session.token,
      "/mcp-servers/{serverId}",
      ["mcp-servers", mcpServerId],
      "DELETE"
    );

    const skill = await callRoute(session.token, "/skills", ["skills"], "POST", {
      body: {
        name: "Coverage skill",
        description: "Coverage fixture",
        content: "Use the coverage flow.",
        enabled: true
      }
    });
    const skillId = ((await skill.json()) as { data: { skill: { id: string } } }).data.skill.id;
    await callRoute(session.token, "/skills/{skillId}", ["skills", skillId], "PATCH", {
      body: { enabled: false }
    });
    await callRoute(session.token, "/skills/{skillId}", ["skills", skillId], "DELETE");

    const createdUser = await callRoute(session.token, "/users", ["users"], "POST", {
      body: {
        username: "coverage-removable",
        password: "CoverageRemovablePassword123!",
        role: "user"
      }
    });
    const removableUserId = ((await createdUser.json()) as { data: { user: { id: string } } }).data
      .user.id;
    await callRoute(session.token, "/users/{userId}", ["users", removableUserId], "DELETE");

    await callRoute(
      session.token,
      "/providers/{profileId}/connection",
      ["providers", "profile_mobile_routes", "connection"],
      "PUT",
      { body: { credential: "sk-coverage-connection" } }
    );
    await callRoute(
      session.token,
      "/providers/{profileId}/connection/flows",
      ["providers", "profile_mobile_routes", "connection", "flows"],
      "POST"
    );
    await callRoute(
      session.token,
      "/providers/{profileId}/connection/flows/{flowId}",
      ["providers", "profile_mobile_routes", "connection", "flows", "flow_missing"],
      "GET"
    );
    await callRoute(
      session.token,
      "/providers/{profileId}/connection/flows/{flowId}",
      ["providers", "profile_mobile_routes", "connection", "flows", "flow_missing"],
      "DELETE"
    );
    await callRoute(
      session.token,
      "/providers/{profileId}/models",
      ["providers", "profile_absent", "models"],
      "GET"
    );
    await callRoute(
      session.token,
      "/providers/{profileId}/connection",
      ["providers", "profile_mobile_routes", "connection"],
      "DELETE"
    );

    const bots = await callRoute(session.token, "/bots", ["bots"], "GET");
    const botId = ((await bots.json()) as { data: { bots: Array<{ id: string }> } }).data.bots[0].id;
    const deletedBotMemory = await callRoute(
      session.token,
      "/bots/{botId}/memories",
      ["bots", botId, "memories"],
      "DELETE",
      { query: "?memoryId=memory_missing" }
    );
    await expect(deletedBotMemory.json()).resolves.toEqual({ data: { deleted: true } });
    await callRoute(
      session.token,
      "/bots/{botId}/reset-browser-session",
      ["bots", botId, "reset-browser-session"],
      "POST"
    );

    const avatarPath = ["avatars", "coverage_seed"];
    const avatar = await mobileGet(request(avatarPath, session.token), context(avatarPath));
    expect(avatar.status).toBe(200);
    expect(avatar.headers.get("content-type")).toContain("image/svg+xml");
    recordOperationCoverage("/avatars/{seed}", "get");

    await callRoute(
      session.token,
      "/conversations/{conversationId}",
      ["conversations", conversationId],
      "DELETE"
    );
    await callRoute(session.token, "/folders/{folderId}", ["folders", folderId], "DELETE");
  });

  it("asserts every documented operation against the contract", () => {
    const uncovered = documentedOperations.filter(
      (operation) =>
        !coveredOperations.has(operation) && !operationsWithoutJsonConformance.has(operation)
    );

    expect(
      uncovered,
      [
        "Every operation in contracts/mobile-api-v1.openapi.json must either be exercised",
        "through assertResponseContract in this suite or be listed in",
        "operationsWithoutJsonConformance with a reason.",
        "",
        ...uncovered.map((operation) => `  ${operation}`)
      ].join("\n")
    ).toEqual([]);
  });
});

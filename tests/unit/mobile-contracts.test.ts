import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as getServerInfo } from "@/app/api/v1/server-info/route";
import * as mobileLoginRoute from "@/app/api/v1/auth/login/route";
import * as mobileLogoutRoute from "@/app/api/v1/auth/logout/route";
import * as mobileSessionRoute from "@/app/api/v1/auth/session/route";
import * as mobileSessionsRoute from "@/app/api/v1/auth/sessions/route";
import * as mobileSessionRevokeRoute from "@/app/api/v1/auth/sessions/[sessionId]/route";
import {
  exportedMethods,
  mobileApiOperations,
  mobileApiRoutePatterns
} from "@/app/api/v1/[...path]/route";
import {
  MAX_ATTACHMENTS_PER_UPLOAD,
  MAX_ATTACHMENT_BYTES,
  MAX_RESEARCH_PLAN_STEPS,
  MAX_RESEARCH_PLAN_STEP_CHARS,
  MOBILE_API_MINIMUM_SERVER_VERSION
} from "@/lib/constants";
import {
  OPENAI_GPT_IMAGE_MODEL_IDS,
  OPENAI_GPT_IMAGE_QUALITIES
} from "@/lib/image-generation/catalog";
import {
  assertOpenApiResponse,
  assertWebSocketMessage,
  compileOpenApiJsonRequestBodies,
  compileOpenApiJsonResponses
} from "@/tests/fixtures/mobile-contract-validator";

const openApiPath = path.join(process.cwd(), "contracts/mobile-api-v1.openapi.json");
const websocketSchemaPath = path.join(
  process.cwd(),
  "contracts/mobile-api-v1.websocket.schema.json"
);

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"];

const directlyRoutedOperations: Array<{ path: string; methods: string[] }> = [
  { path: "/auth/login", methods: exportedMethods(mobileLoginRoute) },
  { path: "/auth/session", methods: exportedMethods(mobileSessionRoute) },
  { path: "/auth/logout", methods: exportedMethods(mobileLogoutRoute) },
  { path: "/auth/sessions", methods: exportedMethods(mobileSessionsRoute) },
  { path: "/auth/sessions/{sessionId}", methods: exportedMethods(mobileSessionRevokeRoute) },
  { path: "/server-info", methods: exportedMethods({ GET: getServerInfo }) }
];

function mountedOperations() {
  return [...mobileApiOperations, ...directlyRoutedOperations];
}

function contractOperations(contract: { paths: Record<string, Record<string, unknown>> }) {
  return Object.entries(contract.paths).map(([pathname, pathValue]) => ({
    path: pathname,
    methods: Object.keys(pathValue)
      .filter((key) => HTTP_VERBS.includes(key))
      .sort()
  }));
}

function describeOperation(operation: { path: string; methods: string[] }) {
  return `${operation.methods.map((method) => method.toUpperCase()).join(",")} ${operation.path}`;
}

function canBothMatch(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const other = right[index];
    return segment.startsWith(":") || other.startsWith(":") || segment === other;
  });
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function resolveLocalRef(document: Record<string, unknown>, ref: string) {
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], document);
}

function collectSchemaPropertyNames(
  value: unknown,
  document?: Record<string, unknown>,
  names = new Set<string>(),
  visitedRefs = new Set<string>()
) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSchemaPropertyNames(item, document, names, visitedRefs));
    return names;
  }
  if (!value || typeof value !== "object") return names;
  const record = value as Record<string, unknown>;
  if (
    document &&
    typeof record.$ref === "string" &&
    record.$ref.startsWith("#/") &&
    !visitedRefs.has(record.$ref)
  ) {
    visitedRefs.add(record.$ref);
    collectSchemaPropertyNames(
      resolveLocalRef(document, record.$ref),
      document,
      names,
      visitedRefs
    );
  }
  if (record.properties && typeof record.properties === "object") {
    Object.keys(record.properties as Record<string, unknown>).forEach((name) => names.add(name));
  }
  Object.values(record).forEach((item) =>
    collectSchemaPropertyNames(item, document, names, visitedRefs)
  );
  return names;
}

describe("Mobile API v1 contracts", () => {
  const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const originalPasswordLogin = process.env.EIDON_PASSWORD_LOGIN_ENABLED;

  afterEach(() => {
    if (originalVersion === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
    else process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
    if (originalPasswordLogin === undefined) delete process.env.EIDON_PASSWORD_LOGIN_ENABLED;
    else process.env.EIDON_PASSWORD_LOGIN_ENABLED = originalPasswordLogin;
  });

  it("publishes compatible and deliberately small server metadata", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v3.7.0-test";
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "false";
    const response = await getServerInfo();
    const body = await response.json() as {
      data: Record<string, unknown> & {
        capabilities: Record<string, boolean>;
        attachmentLimits: Record<string, number>;
      };
    };

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toMatchObject({
      applicationName: "Eidon",
      releaseVersion: "v3.7.0-test",
      supportedApiVersions: ["v1"],
      passwordLoginAvailable: false,
      websocketPath: "/api/v1/ws",
      minimumClientVersion: null,
      minimumNativeCompatibleServerVersion: MOBILE_API_MINIMUM_SERVER_VERSION,
      attachmentLimits: {
        maxCountPerUpload: MAX_ATTACHMENTS_PER_UPLOAD,
        maxBytesPerAttachment: MAX_ATTACHMENT_BYTES
      }
    });
    expect(body.data.capabilities).toMatchObject({
      conversations: true,
      automations: true,
      providerConnections: true,
      releaseHighlights: true,
      providerReasoningControl: true,
      deepResearch: true,
      offlineMutations: false,
      pushNotifications: true
    });
    expect(JSON.stringify(body)).not.toMatch(
      /apiKey|passwordHash|sessionSecret|encryptionSecret|providerProfiles|mcpServers/i
    );
    assertOpenApiResponse("/server-info", "get", response.status, body);
  });

  it("checks in a resolved OpenAPI 3.1 contract covering every native domain", () => {
    const contract = readJson(openApiPath) as {
      openapi: string;
      info: { version: string };
      security: unknown[];
      tags: Array<{ name: string }>;
      paths: Record<string, Record<string, unknown>>;
      components: {
        securitySchemes: Record<string, unknown>;
        parameters: Record<string, Record<string, unknown>>;
        requestBodies: Record<string, unknown>;
        responses: Record<string, Record<string, unknown>>;
        schemas: Record<
          string,
          {
            properties?: Record<string, unknown>;
            required?: string[];
            [key: string]: unknown;
          }
        >;
      };
    };

    expect(contract.openapi).toBe("3.1.0");
    expect(contract.info.version).toBe("1.0.0");
    expect(contract.security).toEqual([{ mobileBearer: [] }]);
    expect(contract.components.securitySchemes.mobileBearer).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "Eidon mobile session JWT"
    });

    const contractOperationKeys = new Set(
      contractOperations(contract).map((operation) => describeOperation(operation))
    );
    const mountedOperationKeys = new Set(
      mountedOperations().map((operation) =>
        describeOperation({ path: operation.path, methods: [...operation.methods].sort() })
      )
    );
    expect([...mountedOperationKeys].filter((key) => !contractOperationKeys.has(key))).toEqual([]);
    expect([...contractOperationKeys].filter((key) => !mountedOperationKeys.has(key))).toEqual([]);
    expect(mountedOperationKeys.size).toBeGreaterThan(90);
    expect(
      contractOperations(contract).reduce((total, operation) => total + operation.methods.length, 0)
    ).toBeGreaterThan(120);

    const shadowedRoutes: string[] = [];
    for (let index = 0; index < mobileApiRoutePatterns.length; index += 1) {
      const earlier = mobileApiRoutePatterns[index];
      for (let other = index + 1; other < mobileApiRoutePatterns.length; other += 1) {
        const later = mobileApiRoutePatterns[other];
        if (!canBothMatch(earlier, later)) continue;
        if (earlier.some((segment, position) => segment.startsWith(":") && !later[position].startsWith(":"))) {
          shadowedRoutes.push(`${earlier.join("/")} shadows ${later.join("/")}`);
        }
      }
    }
    expect(shadowedRoutes).toEqual([]);

    for (const pathname of [
      "/composer/references",
      "/research/plan",
      "/conversations/{conversationId}/research",
      "/settings/semantic-recall",
      "/pushover",
      "/skills/maintenance",
      "/skills/curator/ledger",
      "/skills/curator/purge",
      "/skills/curator/rollback",
      "/bots/{botId}/skills/maintenance",
      "/mcp-servers/{serverId}/oauth",
      "/mcp-servers/{serverId}/oauth/flows"
    ]) {
      expect(contract.paths[pathname]).toBeDefined();
    }
    expect(contract.paths["/settings/semantic-recall"].post).toMatchObject({
      "x-eidon-role": "admin"
    });
    expect(contract.paths["/mcp-servers/{serverId}/oauth"].delete).toMatchObject({
      "x-eidon-role": "admin"
    });
    expect(contract.paths["/mcp-servers/{serverId}/oauth/flows"].post).toMatchObject({
      "x-eidon-role": "admin"
    });
    expect(contract.components.schemas.PushoverCredentialsRequest.properties).toMatchObject({
      userKey: { writeOnly: true },
      appToken: { writeOnly: true }
    });
    expect(contract.paths["/push/vapid"].get).toMatchObject({
      responses: { "200": { $ref: "#/components/responses/VapidPublicKey" } }
    });
    expect(contract.components.schemas.VapidPublicKeyEnvelope).toMatchObject({
      properties: { data: { required: ["publicKey"] } }
    });
    expect(contract.components.schemas.PushSubscriptionListEnvelope).toMatchObject({
      properties: { data: { required: ["subscriptions"] } }
    });
    expect(contract.components.schemas.PushSubscriptionEnvelope).toMatchObject({
      properties: { data: { required: ["subscription"] } }
    });
    expect(contract.paths["/bots/{botId}/memories"].delete).toMatchObject({
      responses: { "200": { $ref: "#/components/responses/Deleted" } }
    });
    expect(contract.paths["/attachments/{attachmentId}"].get).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/AttachmentTextPreviewEnvelope" } }
          }
        }
      }
    });
    expect(contract.paths["/avatars/{seed}"].get).toMatchObject({
      parameters: [{ name: "animated" }]
    });
    expect(contract.paths["/conversations"].get).toMatchObject({
      parameters: [{ $ref: "#/components/parameters/cursor" }, { $ref: "#/components/parameters/conversationPageLimit" }]
    });
    expect(contract.components.parameters.conversationPageLimit).toMatchObject({
      schema: { maximum: 50 }
    });
    expect(contract.components.schemas.ResearchPlanRequest.properties).toMatchObject({
      message: { maxLength: 150000 }
    });
    expect(contract.components.schemas.ResearchPlanRequest.dependentRequired).toEqual({
      currentPlan: ["instruction"],
      instruction: ["currentPlan"]
    });
    expect(contract.components.schemas.SettingsBundleUpdateRequest).toMatchObject({
      minProperties: 1,
      properties: {
        botPrompt: { properties: { prompt: { maxLength: 64000 } } },
        semanticRecall: { properties: { enabled: { type: "boolean" } } }
      }
    });
    expect(contract.components.schemas.AutomationCreateRequest.properties!.scheduleKind).toEqual({
      type: "string",
      enum: ["interval", "calendar", "once"]
    });
    expect(contract.components.schemas.AutomationProposalPayload).toMatchObject({
      required: expect.arrayContaining(["runAt"]),
      properties: { scheduleKind: { enum: ["interval", "calendar", "once"] } }
    });
    expect(contract.components.schemas.Action.properties!.kind).toMatchObject({
      enum: expect.arrayContaining(["skill_review"])
    });
    expect(contract.components.schemas.Memory.required).toEqual(
      expect.arrayContaining(["pinned"])
    );
    expect(contract.components.schemas.Settings.required).toEqual(
      expect.arrayContaining(["semanticRecallEnabled"])
    );
    expect(contract.components.schemas.Automation.required).toEqual(
      expect.arrayContaining(["continuePreviousConversation", "notifyConfig"])
    );
    expect(contract.components.schemas.QueuedMessageCreateRequest.properties!.content).toMatchObject({
      maxLength: 150000
    });
    expect(contract.components.schemas.ChatMessageRequest.properties!.message).toMatchObject({
      maxLength: 150000
    });
    expect(contract.components.schemas.UserUpdateRequest.properties!.password).toMatchObject({
      writeOnly: true,
      anyOf: [{ const: "" }, { type: "string", minLength: 8 }]
    });
    expect(contract.tags.map((tag: { name: string }) => tag.name)).toEqual(
      expect.arrayContaining(["Speech", "Push", "Research", "Skills"])
    );
    expect(contract.paths["/server-info"].get).toMatchObject({ security: [] });
    expect(contract.paths["/whats-new"].get).toMatchObject({
      operationId: "getReleaseHighlights",
      responses: { "200": { $ref: "#/components/responses/ReleaseHighlights" } }
    });
    expect(contract.paths["/whats-new"].post).toMatchObject({
      operationId: "acknowledgeReleaseHighlights",
      responses: { "200": { $ref: "#/components/responses/ReleaseHighlightsAcknowledged" } }
    });
    const releaseHighlightsEnvelope = contract.components
      .schemas.ReleaseHighlightsEnvelope as unknown as {
      properties: { data: { properties: { whatsNew: { oneOf: unknown[] } } } };
    };
    expect(releaseHighlightsEnvelope.properties.data.properties.whatsNew.oneOf).toContainEqual({
      type: "null"
    });
    expect(contract.paths["/auth/login"].post).toMatchObject({ security: [] });
    expect(contract.paths["/users"].get).toMatchObject({ "x-eidon-role": "admin" });
    expect(contract.paths["/speech/transcription/transcribe"].post).toMatchObject({
      parameters: [{ $ref: "#/components/parameters/speechAudioSampleRate" }],
      requestBody: { $ref: "#/components/requestBodies/RecordedSpeechAudio" },
      responses: { "200": { $ref: "#/components/responses/SpeechTranscription" } }
    });
    expect(contract.paths["/bots/approvals"].get).toMatchObject({
      operationId: "listPendingBotApprovals",
      tags: ["Agents"],
      responses: { "200": { $ref: "#/components/responses/PendingBotApprovalList" } }
    });
    expect(contract.paths["/conversations/{conversationId}"]).toMatchObject({
      patch: { responses: { "409": { $ref: "#/components/responses/Error" } } },
      delete: {
        operationId: "deleteConversation",
        responses: {
          "200": { $ref: "#/components/responses/ConversationDelete" },
          "409": { $ref: "#/components/responses/Error" }
        }
      }
    });
    expect(contract.paths["/bots/{botId}/clear-context"]).toMatchObject({
      parameters: [{ $ref: "#/components/parameters/botId" }]
    });
    expect(contract.paths["/bots/{botId}/clear-context"].post).toMatchObject({
      operationId: "clearBotContext",
      tags: ["Agents"],
      responses: {
        "200": { $ref: "#/components/responses/BotContextCleared" },
        "409": { $ref: "#/components/responses/Error" }
      }
    });
    expect(contract.paths["/bots/{botId}/read"].post).toMatchObject({
      operationId: "markBotRead",
      responses: { "200": { $ref: "#/components/responses/BotRead" } }
    });
    expect(contract.paths["/bots/{botId}/stop"].post).toMatchObject({
      operationId: "stopBot",
      responses: { "200": { $ref: "#/components/responses/Bot" } }
    });
    expect(contract.paths["/bots/{botId}/runs/{runId}/stop"]).toMatchObject({
      parameters: [{ $ref: "#/components/parameters/botId" }, { $ref: "#/components/parameters/runId" }],
      post: { operationId: "stopBotRun", responses: { "200": { $ref: "#/components/responses/BotRunStopped" } } }
    });
    expect(contract.paths["/speech/transcription/cleanup"].post).toMatchObject({
      requestBody: { $ref: "#/components/requestBodies/SpeechCleanup" },
      responses: { "200": { $ref: "#/components/responses/SpeechCleanup" } }
    });
    expect(contract.components.requestBodies.RecordedSpeechAudio).toMatchObject({
      required: true,
      content: {
        "application/octet-stream": {}
      }
    });

    const attachmentProperties = contract.components.schemas.Attachment.properties!;
    expect(attachmentProperties).not.toHaveProperty("relativePath");
    expect(attachmentProperties).not.toHaveProperty("extractedText");
    expect(attachmentProperties).not.toHaveProperty("sourcePath");
    expect(contract.components.schemas.User.properties).not.toHaveProperty("passwordHash");
    expect(contract.components.schemas.MemoryProposalPayload.properties!.botId).toEqual({
      $ref: "#/components/schemas/NullableId"
    });
    const speechTranscriptionUpdate = contract.components.schemas.SpeechTranscriptionUpdate as unknown as {
      oneOf: Array<{
        properties: {
          providerId: { const: string };
          configuration: { oneOf?: Array<{ properties: { model: { const: string } } }> };
        };
      }>;
    };
    const assemblyAiUpdate = speechTranscriptionUpdate.oneOf.find(
      ({ properties }) => properties.providerId.const === "assemblyai"
    );
    expect(assemblyAiUpdate?.properties.configuration.oneOf?.map(
      ({ properties }) => properties.model.const
    )).toEqual(["universal-3-5-pro", "universal-2"]);
    const universal35Languages = contract.components.schemas
      .AssemblyAiUniversal35Language as unknown as { enum: string[] };
    const universal2Languages = contract.components.schemas
      .AssemblyAiUniversal2Language as unknown as { enum: string[] };
    expect(universal35Languages.enum).toHaveLength(19);
    expect(universal35Languages.enum).not.toContain("sw");
    expect(universal2Languages.enum).toContain("sw");
    expect(universal2Languages.enum).toHaveLength(103);

    const providerProfileSummary = contract.components.schemas.ProviderProfileSummary as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(providerProfileSummary.required).toEqual(
      expect.arrayContaining(["reasoningEffort", "reasoningControl", "reasoningEfforts"])
    );
    expect(providerProfileSummary.properties.reasoningControl).toMatchObject({
      type: "string",
      enum: ["levels", "toggle"]
    });
    expect(providerProfileSummary.properties.reasoningEfforts).toMatchObject({
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { $ref: "#/components/schemas/ReasoningEffort" }
    });
    expect(contract.paths["/settings/providers"].put).toMatchObject({
      responses: { "400": { $ref: "#/components/responses/Error" } }
    });
    expect(contract.components.schemas.ChatMessageRequest.properties!.research).toEqual({
      $ref: "#/components/schemas/ChatResearchRequest"
    });
    expect(contract.components.schemas.ChatResearchRequest).toMatchObject({
      additionalProperties: false,
      properties: {
        plan: {
          type: "array",
          minItems: 1,
          maxItems: MAX_RESEARCH_PLAN_STEPS,
          items: { type: "string", minLength: 1, maxLength: MAX_RESEARCH_PLAN_STEP_CHARS }
        }
      }
    });
    expect(compileOpenApiJsonRequestBodies()).toBe(56);
    expect(compileOpenApiJsonResponses()).toBe(221);
  });

  it("widens the image generation enums for GPT Image 2.5", () => {
    const contract = readJson(openApiPath) as {
      components: {
        schemas: {
          ImageGenerationUpdate: {
            oneOf: Array<{
              properties: {
                providerId: { const?: string };
                configuration: {
                  properties?: { model?: { enum: string[] }; quality?: { enum: string[] } };
                };
              };
            }>;
          };
        };
      };
    };

    const openAi = contract.components.schemas.ImageGenerationUpdate.oneOf.find(
      (branch) => branch.properties.providerId.const === "openai_gpt_image"
    );
    expect(openAi).toBeDefined();
    expect(openAi?.properties.configuration.properties?.model?.enum).toEqual([...OPENAI_GPT_IMAGE_MODEL_IDS]);
    expect(openAi?.properties.configuration.properties?.quality?.enum).toEqual([...OPENAI_GPT_IMAGE_QUALITIES]);
  });

  it("publishes a concrete WebSocket schema for recovery, queues, and lifecycle events", () => {
    const contract = readJson(websocketSchemaPath) as {
      $schema: string;
      oneOf: unknown[];
      $defs: Record<string, {
        oneOf?: Array<Record<string, unknown>>;
        properties?: Record<string, unknown>;
      }>;
    };

    expect(contract.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(contract.oneOf).toHaveLength(4);
    expect(Object.keys(contract.$defs)).toEqual(expect.arrayContaining([
      "Attachment",
      "Action",
      "Segment",
      "TimelineText",
      "TimelineThinking",
      "TimelineAction",
      "TimelineItem",
      "Message",
      "Conversation",
      "ChatEvent",
      "ClientMessage",
      "ServerMessage"
    ]));

    const clientMessages = JSON.stringify(contract.$defs.ClientMessage);
    expect(clientMessages).toContain("request_snapshot");
    expect(clientMessages).toContain("reorder_queued_messages");
    expect(clientMessages).not.toContain('"edit"');
    expect(contract.$defs.ChatResearchRequest).toMatchObject({
      properties: { plan: { maxItems: MAX_RESEARCH_PLAN_STEPS } }
    });
    const message = { type: "message", conversationId: "conv_1", content: "Compare the options" };
    expect(() => assertWebSocketMessage("ClientMessage", { ...message, research: {} })).not.toThrow();
    expect(() => assertWebSocketMessage("ClientMessage", {
      ...message,
      research: { plan: ["Survey the sources"] }
    })).not.toThrow();
    expect(() => assertWebSocketMessage("ClientMessage", { ...message, research: true })).toThrow(
      /ClientMessage failed contract validation/
    );
    const serverMessages = JSON.stringify(contract.$defs.ServerMessage);
    expect(serverMessages).toContain("protocolVersion");
    expect(serverMessages).toContain("conversation_title_updated");
    expect(serverMessages).toContain("conversation_cleared");
    expect(serverMessages).toContain("messages_deleted");
    expect(() => assertWebSocketMessage("ServerMessage", {
      type: "messages_deleted",
      conversationId: "conv_1",
      messageIds: ["msg_1", "msg_2"]
    })).not.toThrow();
    expect(() => assertWebSocketMessage("ServerMessage", {
      type: "messages_deleted",
      conversationId: "conv_1",
      messageIds: []
    })).toThrow(/ServerMessage failed contract validation/);
    expect(serverMessages).toContain("bot_updated");
    expect(serverMessages).toContain("bot_deleted");
    expect(serverMessages).toContain("bot_run_updated");
    expect(serverMessages).toContain("bot_activity");
    expect(serverMessages).toContain("code");

    const computerState = { type: "computer_state", live: true, controlOwner: "bot", url: "https://example.com/", caption: "agent-browser open https://example.com", viewport: { width: 1280, height: 720 } };
    expect(() => assertWebSocketMessage("ComputerServerMessage", computerState)).not.toThrow();
    expect(() => assertWebSocketMessage("ComputerServerMessage", { ...computerState, viewport: null, url: null, caption: null, live: false })).not.toThrow();
    expect(() => assertWebSocketMessage("ComputerServerMessage", { ...computerState, frame: "base64" })).toThrow(
      /ComputerServerMessage failed contract validation/
    );
    for (const input of [
      { type: "computer_pointer", action: "down", x: 0.5, y: 0.25, button: "left", clickCount: 1 },
      { type: "computer_wheel", x: 0.5, y: 0.5, deltaX: 0, deltaY: 120 },
      { type: "computer_key", action: "down", key: "Enter", modifiers: 4 },
      { type: "computer_text", text: "hello" }
    ]) {
      expect(() => assertWebSocketMessage("ComputerClientMessage", input)).not.toThrow();
    }
    expect(() => assertWebSocketMessage("ComputerClientMessage", { type: "computer_pointer", action: "down", x: 1.5, y: 0 })).toThrow(
      /ComputerClientMessage failed contract validation/
    );

    expect(contract.$defs.Attachment.properties).not.toHaveProperty("relativePath");
    expect(contract.$defs.Attachment.properties).not.toHaveProperty("extractedText");

    expect(contract.$defs.Attachment.properties!.kind).toMatchObject({
      enum: ["image", "text", "file"]
    });
    expect(contract.$defs.Action.properties!.kind).toMatchObject({
      enum: expect.arrayContaining(["skill_review"])
    });
    expect(contract.$defs.MemoryProposalPayload.properties).toHaveProperty("botId");
    expect(() => assertWebSocketMessage("ServerMessage", {
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "context_usage",
        contextTokens: 1200,
        compactionLimit: 100000,
        memoriesUsed: 3,
        memoriesTotal: 12
      }
    })).not.toThrow();
    expect(() => assertWebSocketMessage("ClientMessage", {
      type: "message",
      conversationId: "conv_1",
      content: "a".repeat(150000)
    })).not.toThrow();
    expect(() => assertWebSocketMessage("ClientMessage", {
      type: "message",
      conversationId: "conv_1",
      content: "a".repeat(150001)
    })).toThrow(/ClientMessage failed contract validation/);
    expect(() => assertWebSocketMessage("ComputerClientMessage", {
      type: "computer_key",
      action: "down",
      key: "Enter",
      code: "Enter",
      modifiers: 4
    })).not.toThrow();
    expect(() => assertWebSocketMessage("ServerMessage", {
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        {
          id: "msg_1",
          conversationId: "conv_1",
          role: "assistant",
          content: "Result",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 10,
          createdAt: "2026-01-01T00:00:00.000Z",
          attachments: [
            {
              id: "att_1",
              conversationId: "conv_1",
              messageId: "msg_1",
              filename: "notes.pdf",
              mimeType: "application/pdf",
              byteSize: 12,
              sha256: "abc",
              kind: "file",
              createdAt: "2026-01-01T00:00:00.000Z"
            }
          ]
        }
      ],
      actions: [],
      segments: [],
      queuedMessages: []
    })).not.toThrow();
  });

  it("declares every retry event the assistant runtime streams to clients", () => {
    const contract = readJson(websocketSchemaPath) as {
      $defs: { ChatEvent: { oneOf: Array<{ properties: { type: { const?: string; enum?: string[] } } }> } };
    };
    const eventTypes = contract.$defs.ChatEvent.oneOf.flatMap(({ properties }) =>
      properties.type.const ? [properties.type.const] : properties.type.enum ?? []
    );
    expect(eventTypes).toEqual(expect.arrayContaining(["stream_retry", "answer_reset"]));

    const delta = (event: unknown) => ({ type: "delta", conversationId: "conv_1", event });
    expect(() => assertWebSocketMessage("ServerMessage", delta({ type: "answer_reset" }))).not.toThrow();
    expect(() => assertWebSocketMessage("ServerMessage", delta({ type: "stream_retry", attempt: 2 }))).not.toThrow();
    expect(() => assertWebSocketMessage("ServerMessage", delta({ type: "answer_reset", text: "" }))).toThrow(
      /ServerMessage failed contract validation/
    );
  });

  it("keeps forbidden secret and persistence fields out of response DTO properties", () => {
    const openApi = readJson(openApiPath) as {
      components: {
        responses: Record<string, unknown>;
        schemas: Record<string, { properties?: Record<string, Record<string, unknown>> }>;
      };
    };
    const websocket = readJson(websocketSchemaPath);
    const propertyNames = new Set([
      ...collectSchemaPropertyNames(openApi.components.responses, openApi),
      ...collectSchemaPropertyNames(websocket, websocket)
    ]);

    for (const forbidden of [
      "apiKey",
      "apiKeyEncrypted",
      "bearerToken",
      "githubRefreshToken",
      "githubUserAccessToken",
      "passwordHash",
      "relativePath",
      "extractedText",
      "shareToken",
      "debug",
      "userKey",
      "appToken"
    ]) {
      expect([...propertyNames]).not.toContain(forbidden);
    }

    expect(openApi.components.schemas.ProviderProfileCoreWrite.properties?.credential).toMatchObject({
      writeOnly: true
    });
    expect(openApi.components.schemas.McpHttpServerDraft.properties?.headers).toMatchObject({
      writeOnly: true
    });
    expect(openApi.components.schemas.McpStdioServerDraft.properties?.env).toMatchObject({
      writeOnly: true
    });
  });

  it("packages the exact contract files in pull-request and release workflows", () => {
    const testWorkflow = fs.readFileSync(
      path.join(process.cwd(), ".github/workflows/test.yml"),
      "utf8"
    );
    const dockerStableWorkflow = fs.readFileSync(
      path.join(process.cwd(), ".github/workflows/docker-stable.yml"),
      "utf8"
    );

    for (const contractPath of [
      "contracts/mobile-api-v1.openapi.json",
      "contracts/mobile-api-v1.websocket.schema.json"
    ]) {
      expect(testWorkflow).toContain(contractPath);
      expect(dockerStableWorkflow).toContain(contractPath);
    }
    expect(dockerStableWorkflow).toContain("gh release upload");
  });
});

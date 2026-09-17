import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as getServerInfo } from "@/app/api/v1/server-info/route";
import {
  MAX_ATTACHMENTS_PER_UPLOAD,
  MAX_ATTACHMENT_BYTES,
  MOBILE_API_MINIMUM_SERVER_VERSION
} from "@/lib/constants";
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
      offlineMutations: false,
      pushNotifications: false
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
      paths: Record<string, Record<string, unknown>>;
      components: {
        securitySchemes: Record<string, unknown>;
        requestBodies: Record<string, unknown>;
        schemas: Record<string, { properties?: Record<string, unknown> }>;
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

    expect(Object.keys(contract.paths)).toEqual(expect.arrayContaining([
      "/server-info",
      "/whats-new",
      "/auth/login",
      "/auth/session",
      "/auth/sessions/{sessionId}",
      "/conversations",
      "/conversations/search",
      "/conversations/{conversationId}/queue/order",
      "/folders/{folderId}",
      "/attachments/{attachmentId}",
      "/speech/transcription/prepare",
      "/speech/transcription/transcribe",
      "/speech/transcription/cleanup",
      "/automations/{automationId}/runs",
      "/automation-runs/{runId}",
      "/bots",
      "/bots/{botId}",
      "/bots/{botId}/clear-context",
      "/bots/{botId}/memories",
      "/bots/{botId}/reset-browser-session",
      "/bots/{botId}/workspace",
      "/avatars/{seed}",
      "/messages/{messageId}/edit-restart",
      "/message-actions/{actionId}/approve",
      "/settings/providers",
      "/settings/general",
      "/personas",
      "/memories",
      "/mcp-servers",
      "/skills",
      "/users",
      "/providers/{profileId}/connection",
      "/providers/{profileId}/connection/flows",
      "/providers/{profileId}/connection/flows/{flowId}",
      "/providers/{profileId}/models"
    ]));
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
    expect(compileOpenApiJsonRequestBodies()).toBe(41);
    expect(compileOpenApiJsonResponses()).toBe(109);
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
    expect(contract.oneOf).toHaveLength(2);
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
    const serverMessages = JSON.stringify(contract.$defs.ServerMessage);
    expect(serverMessages).toContain("protocolVersion");
    expect(serverMessages).toContain("conversation_title_updated");
    expect(serverMessages).toContain("conversation_cleared");
    expect(serverMessages).toContain("bot_updated");
    expect(serverMessages).toContain("bot_deleted");
    expect(serverMessages).toContain("bot_run_updated");
    expect(serverMessages).toContain("bot_activity");
    expect(serverMessages).toContain("code");

    expect(contract.$defs.Attachment.properties).not.toHaveProperty("relativePath");
    expect(contract.$defs.Attachment.properties).not.toHaveProperty("extractedText");
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
      "debug"
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

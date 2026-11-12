import fs from "node:fs";
import path from "node:path";
import type {
  ChatStreamEvent,
  PromptMessage,
  ProviderResponseItem,
  RuntimeProviderProfile,
  Skill
} from "@/lib/types";
import { createRuntimeAppSettings, createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const streamProviderResponse = vi.fn();
const callProviderText = vi.fn();
const callMcpTool = vi.fn();
const discoverMcpTools = vi.fn();
const getToolResultText = vi.fn();
const localShellMocks = vi.hoisted(() => ({
  executeLocalShellCommand: vi.fn(),
  summarizeShellResult: vi.fn()
}));
const getMemoryRecord = vi.fn();
const createMemoryFn = vi.fn();
const updateMemoryRecord = vi.fn();
const deleteMemoryRecord = vi.fn();
const getMemoryCountFn = vi.fn();
const listMemoriesForPromptFn = vi.fn();
const getSettingsFn = vi.fn();
const searchSearxng = vi.fn();
const generateGoogleNanoBananaImages = vi.fn();
const createAttachments = vi.fn();
const bindAttachmentsToMessage = vi.fn();
const deleteAttachmentById = vi.fn();
const resolveAttachmentPath = vi.fn();
const resolveAbsoluteImagePathPart = vi.fn();
const readWebPage = vi.fn();

vi.mock("@/lib/provider", () => ({
  streamProviderResponse,
  callProviderText
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool,
  discoverMcpTools,
  getToolResultText,
  MAX_MCP_RESULT_CHARS: 32_000
}));

vi.mock("@/lib/local-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-shell")>();
  return {
    ...actual,
    executeLocalShellCommand: localShellMocks.executeLocalShellCommand,
    summarizeShellResult: localShellMocks.summarizeShellResult
  };
});

vi.mock("@/lib/memories", () => ({
  getMemory: getMemoryRecord,
  createMemory: createMemoryFn,
  updateMemory: updateMemoryRecord,
  deleteMemory: deleteMemoryRecord,
  getMemoryCount: getMemoryCountFn,
  listMemoriesForPrompt: listMemoriesForPromptFn
}));

vi.mock("@/lib/settings", () => ({
  getSettings: getSettingsFn
}));

vi.mock("@/lib/searxng", () => ({
  searchSearxng
}));

vi.mock("@/lib/web-read", () => ({
  readWebPage
}));

vi.mock("@/lib/image-generation/google-nano-banana", () => ({
  generateGoogleNanoBananaImages
}));

vi.mock("@/lib/attachments", () => ({
  createAttachments,
  bindAttachmentsToMessage,
  deleteAttachmentById,
  resolveAttachmentPath,
  resolveAbsoluteImagePathPart
}));

const GOLDEN_DIR = path.resolve(__dirname, "../fixtures/prompt-assembly");
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === "1";

function writeGolden(name: string, value: unknown) {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(GOLDEN_DIR, `${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

function expectGolden(name: string, value: unknown) {
  const actual = JSON.stringify(value);
  if (UPDATE_GOLDEN) {
    writeGolden(name, JSON.parse(actual));
    return;
  }
  const filePath = path.join(GOLDEN_DIR, `${name}.json`);
  const expected = JSON.parse(fs.readFileSync(filePath, "utf8"));
  expect(actual).toBe(JSON.stringify(expected));
}

type ScriptedResponse = {
  answer?: string;
  thinking?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  responseItems?: ProviderResponseItem[];
  usage?: { inputTokens?: number; outputTokens?: number };
  events?: ChatStreamEvent[];
};

function createProviderStream(response: ScriptedResponse) {
  return (async function* () {
    for (const event of response.events ?? []) {
      yield event;
    }
    return {
      answer: response.answer ?? "",
      thinking: response.thinking ?? "",
      toolCalls: response.toolCalls,
      responseItems: response.responseItems,
      usage: response.usage ?? {}
    };
  })();
}

function createSettings(): RuntimeProviderProfile {
  return createRuntimeProviderProfile({
    id: "profile_test",
    name: "Test profile",
    model: "gpt-5-mini",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    modelContextLimit: 16000,
    freshTailCount: 12
  });
}

function createAppSettings(overrides = {}) {
  return createRuntimeAppSettings({
    skillsEnabled: false,
    conversationRetention: "30d",
    memoriesEnabled: false,
    mcpTimeout: 30000,
    imageGeneration: {
      providerId: "google_nano_banana",
      credentials: { apiKey: "google-secret" }
    },
    ...overrides
  });
}

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_release_notes",
    name: "Release Notes",
    description: "Use when writing customer-facing summaries of product changes.",
    content: "Summarize changes for end users in concise release notes.",
    enabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    ...overrides
  };
}

function mcpServer(overrides: Record<string, unknown> = {}) {
  return {
    id: "mcp_docs",
    slug: "docs",
    name: "Docs",
    url: "https://mcp.example.com",
    headers: {},
    transport: "streamable_http" as const,
    command: null,
    args: null,
    env: null,
    enabled: true,
    isVisionMcp: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const roster = [
  { name: "Chief of Staff", title: "", description: "", isChief: true },
  { name: "Writer", title: "Copywriter", description: "", isChief: false }
];

function imageMessage(): PromptMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: "Describe this image." },
      {
        type: "image",
        attachmentId: "att_photo",
        filename: "att_photo_photo.png",
        mimeType: "image/png",
        relativePath: "conv_vision/att_photo_photo.png"
      }
    ]
  };
}

function visionProfile(): RuntimeProviderProfile {
  return createRuntimeProviderProfile({
    id: "profile_vision",
    name: "Vision profile",
    model: "gpt-4o",
    credentials: { apiKey: "sk-vision" }
  });
}

async function runScenario(name: string, responses: ScriptedResponse[], input: Record<string, unknown>) {
  const recorded: PromptMessage[][] = [];
  const queue = [...responses];
  streamProviderResponse.mockImplementation((call: { promptMessages: PromptMessage[] }) => {
    const response = queue.shift();
    if (!response) throw new Error(`Unexpected provider call ${recorded.length + 1} in ${name}`);
    recorded.push(call.promptMessages);
    return createProviderStream(response);
  });

  const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
  await resolveAssistantTurn({
    onEvent: () => {},
    onActionStart: () => "act_golden",
    onActionComplete: () => {},
    mcpToolSets: [],
    skills: [],
    ...input
  });

  expect(streamProviderResponse).toHaveBeenCalledTimes(responses.length);
  expectGolden(name, recorded);
}

describe("prompt assembly golden equivalence", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { createToolApprovalRules } = await import("@/lib/tool-approvals");
    createToolApprovalRules(null, "shell", ["echo", "curl", "agent-browser"]);
    createToolApprovalRules(null, "mcp", ["docs:search_docs", "exa:search", "exa_docs:search"]);
    streamProviderResponse.mockReset();
    callProviderText.mockReset();
    callMcpTool.mockReset();
    discoverMcpTools.mockReset();
    getToolResultText.mockReset();
    localShellMocks.executeLocalShellCommand.mockReset();
    localShellMocks.summarizeShellResult.mockReset();
    getMemoryRecord.mockReset();
    createMemoryFn.mockReset();
    updateMemoryRecord.mockReset();
    deleteMemoryRecord.mockReset();
    getMemoryCountFn.mockReset();
    getMemoryCountFn.mockReturnValue(0);
    listMemoriesForPromptFn.mockReset();
    listMemoriesForPromptFn.mockReturnValue([]);
    getSettingsFn.mockReset();
    getSettingsFn.mockReturnValue({ memoriesMaxCount: 100 });
    searchSearxng.mockReset();
    searchSearxng.mockResolvedValue("SearXNG result text");
    generateGoogleNanoBananaImages.mockReset();
    createAttachments.mockReset();
    bindAttachmentsToMessage.mockReset();
    deleteAttachmentById.mockReset();
    resolveAttachmentPath.mockReset();
    resolveAttachmentPath.mockImplementation(({ relativePath }: { relativePath: string }) => `/tmp/${relativePath}`);
    resolveAbsoluteImagePathPart.mockReset();
    resolveAbsoluteImagePathPart.mockImplementation((absolutePath: string) => ({
      type: "image" as const,
      attachmentId: "att_mock",
      filename: absolutePath.split("/").pop() ?? "photo.png",
      mimeType: "image/png",
      relativePath: absolutePath.replace(/^\/tmp\//, "")
    }));
    callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found MCP docs" }] });
    callProviderText.mockImplementation(({ prompt }: { prompt: string }) => {
      const latestUserLine = prompt.match(/Latest user request:\s*user:\s*([\s\S]*)$/)?.[1]?.trim() ?? "";
      return `\`\`\`json
${JSON.stringify({
  imagePrompt: latestUserLine || "compiled image",
  negativePrompt: "",
  assistantText: "",
  aspectRatio: "1:1",
  count: 1
})}
\`\`\``;
    });
    getToolResultText.mockImplementation((result: { content?: Array<{ text?: string }> }) => {
      return result.content?.[0]?.text ?? "done";
    });
    localShellMocks.summarizeShellResult.mockImplementation((result: { stdout?: string; stderr?: string }) => {
      return result.stdout || result.stderr || "done";
    });
    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("matches the golden capture for a plain chat turn", async () => {
    await runScenario("plain-chat", [{ answer: "It is rainy." }], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "What's the weather in Montreal right now?" }]
    });
  });

  it("matches the golden capture for a bot chat turn with skills and mentions", async () => {
    await runScenario("bot-chat-with-skills", [{ answer: "Done." }], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Use /release notes for the v2 launch, then ask @Writer to polish it." }],
      skills: [createSkill()],
      skillManageEnabled: true,
      botTeam: { isChief: false, roster },
      appSettings: createAppSettings({
        skillsEnabled: true,
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      })
    });
  });

  it("matches the golden capture for a turn with MCP servers and memories", async () => {
    await runScenario("mcp-and-memories", [
      { toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }], usage: { inputTokens: 9 } },
      { answer: "Let me remember that for you.", usage: { inputTokens: 11 } },
      { answer: "All set.", usage: { inputTokens: 12 } }
    ], {
      settings: createSettings(),
      promptMessages: [
        { role: "system", content: "You are Eidon." },
        { role: "user", content: "Find MCP docs" },
        { role: "system", content: "<memory>\nmem_1: [work] Likes tea\n</memory>" }
      ],
      mcpToolSets: [
        { server: mcpServer(), tools: [{ name: "search_docs", title: "Search docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] },
        { server: mcpServer({ id: "mcp_composio", slug: "composio", name: "Composio", url: "https://connect.composio.dev/mcp" }), tools: [], authRequired: true }
      ],
      memoriesEnabled: true,
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com", pipeline: { mode: "off" } }
        }
      })
    });
  });

  it("matches the golden capture for a guidance-redirected turn", async () => {
    const redirects = [{ content: "Hand it to @Writer and use /Release Notes", assistantMessageId: "msg_redirect" }];
    await runScenario("guidance-redirect", [
      { answer: "First draft." },
      { answer: "Redirected." }
    ], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Draft the launch post" }],
      skills: [createSkill()],
      botTeam: { isChief: true, roster },
      appSettings: createAppSettings({ skillsEnabled: true, maxAssistantToolSteps: 4 }),
      takeRedirect: async () => redirects.shift() ?? null
    });
  });

  it("matches the golden capture for an MCP vision turn", async () => {
    const visionServer = mcpServer({
      id: "vision_server",
      slug: "vision",
      name: "Vision MCP",
      url: "https://vision.example.com",
      isVisionMcp: true
    });
    await runScenario("vision-mcp", [{ answer: "I inspected the image." }], {
      settings: { ...createSettings(), visionMode: "mcp" as const },
      promptMessages: [imageMessage()],
      mcpToolSets: [{ server: visionServer, tools: [{ name: "analyze_image", description: "analyze", inputSchema: { type: "object", properties: {} } }] }],
      visionMcpServers: [visionServer]
    });
  });

  it("matches the golden capture for a provider vision turn", async () => {
    await runScenario("vision-provider", [{ answer: "Analyzed." }], {
      settings: { ...createSettings(), visionMode: "provider" as const, visionProviderProfileId: "profile_vision" },
      visionProfile: visionProfile(),
      promptMessages: [imageMessage()]
    });
  });

  it("matches the golden capture for a native vision turn", async () => {
    const visionServer = mcpServer({
      id: "vision_server",
      slug: "vision",
      name: "Vision MCP",
      isVisionMcp: true
    });
    const plainServer = mcpServer({ id: "mcp_plain", slug: "plain", name: "Plain" });
    await runScenario("vision-native", [{ answer: "A shopping cart icon." }], {
      settings: { ...createSettings(), visionMode: "native" as const },
      promptMessages: [imageMessage()],
      mcpToolSets: [
        { server: visionServer, tools: [{ name: "analyze_image", description: "analyze", inputSchema: { type: "object", properties: {} } }] },
        { server: plainServer, tools: [{ name: "do_thing", description: "do", inputSchema: { type: "object", properties: {} } }] }
      ],
      visionMcpServers: [visionServer]
    });
  });

  it("matches the golden capture for a web search turn", async () => {
    await runScenario("web-search", [
      { toolCalls: [{ id: "call_1", name: "web_search", arguments: JSON.stringify({ query: "breaking news" }) }], usage: { inputTokens: 9 } },
      { answer: "Here is the news.", usage: { inputTokens: 11 } }
    ], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "news?" }],
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      })
    });
  });

  it("matches the golden capture for an image generation turn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:34:56Z"));
    await runScenario("image-generation", [
      { toolCalls: [{ id: "call_image", name: "generate_image", arguments: JSON.stringify({ prompt: "a red square" }) }], usage: { inputTokens: 6 } },
      { answer: "Here is the image.", usage: { outputTokens: 4 } }
    ], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate an image of a red square" }],
      appSettings: createAppSettings(),
      conversationId: "conv_golden_image",
      assistantMessageId: "msg_golden_image"
    });
  });

  it("matches the golden capture for a research turn", async () => {
    await runScenario("research", [
      { toolCalls: [{ id: "call_1", name: "web_search", arguments: JSON.stringify({ query: "heat pump subsidies" }) }], usage: { inputTokens: 9 } },
      { answer: "# Report", usage: { inputTokens: 11 } }
    ], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Compare EU heat pump subsidies" }],
      appSettings: createAppSettings({
        skillsEnabled: true,
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
      research: { plan: ["Find official subsidy pages", "Compare amounts per country"] }
    });
  });

  it("matches the golden capture for a forced direct answer turn", async () => {
    await runScenario("forced-answer", [
      { toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }], usage: { inputTokens: 9 } },
      { answer: "Final answer without more tools.", usage: { inputTokens: 11 } }
    ], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Loop forever" }],
      skills: [createSkill()],
      appSettings: createAppSettings({ maxAssistantToolSteps: 1, imageGeneration: { providerId: "disabled" } }),
      mcpToolSets: [{
        server: mcpServer(),
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
      }]
    });
  });

  it("matches the golden capture for an empty answer retry", async () => {
    await runScenario("empty-answer-retry", [
      { answer: "", thinking: "reasoning only", usage: { inputTokens: 5 } },
      { answer: "Connected.", usage: { inputTokens: 3 } }
    ], {
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Reply with connected." }]
    });
  });

  it("matches the golden capture for the conversation base prompt with persona, memories, and compacted history", async () => {
    vi.stubEnv("TZ", "UTC");
    const { buildPromptMessages } = await import("@/lib/compaction");
    const createdAt = "2026-04-10T10:00:00.000Z";
    const prompt = buildPromptMessages({
      systemPrompt: "Stay concise.",
      personaContent: "You are a finance expert. Focus on tax implications.",
      messages: [
        {
          id: "msg_user_1",
          conversationId: "conv_1",
          role: "user",
          content: "Build the report",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 3,
          systemKind: null,
          compactedAt: null,
          createdAt,
          attachments: [
            {
              id: "att_image",
              conversationId: "conv_1",
              messageId: "msg_user_1",
              filename: "photo.png",
              mimeType: "image/png",
              byteSize: 123,
              sha256: "hash",
              relativePath: "conv_1/att_image_photo.png",
              kind: "image",
              extractedText: "",
              createdAt
            },
            {
              id: "att_text",
              conversationId: "conv_1",
              messageId: "msg_user_1",
              filename: "notes.txt",
              mimeType: "text/plain",
              byteSize: 123,
              sha256: "hash",
              relativePath: "conv_1/att_text_notes.txt",
              kind: "text",
              extractedText: "alpha beta gamma delta epsilon zeta eta theta",
              createdAt
            }
          ]
        },
        {
          id: "msg_assistant_1",
          conversationId: "conv_1",
          role: "assistant",
          content: "Here is the report.",
          thinkingContent: "Internal reasoning that stays out.",
          status: "completed",
          estimatedTokens: 4,
          systemKind: null,
          compactedAt: null,
          createdAt,
          actions: [
            {
              id: "act_search",
              messageId: "msg_assistant_1",
              kind: "mcp_tool_call",
              status: "completed",
              serverId: "exa",
              skillId: null,
              toolName: "search",
              label: "search",
              detail: "",
              arguments: { q: "x" },
              resultSummary: "hits: a, b",
              sortOrder: 0,
              startedAt: createdAt,
              completedAt: createdAt,
              proposalState: null,
              proposalPayload: null,
              proposalUpdatedAt: null
            }
          ],
          attachments: [
            {
              id: "att_delivered",
              conversationId: "conv_1",
              messageId: "msg_assistant_1",
              filename: "report.csv",
              mimeType: "text/csv",
              byteSize: 5,
              sha256: "hash",
              relativePath: "conv_1/att_delivered_report.csv",
              kind: "text",
              extractedText: "a,b",
              sourcePath: "/work/bot/report.csv",
              createdAt
            }
          ]
        },
        {
          id: "msg_user_2",
          conversationId: "conv_1",
          role: "user",
          content: "What next?",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 3,
          systemKind: null,
          compactedAt: null,
          createdAt
        }
      ],
      userInput: "Append this",
      activeMemoryNodes: [
        {
          id: "mem_1",
          conversationId: "conv_1",
          type: "leaf_summary",
          depth: 0,
          content: "- Fact: user prefers dark mode\n- Preference: keep responses short",
          sourceStartMessageId: "msg_1",
          sourceEndMessageId: "msg_4",
          sourceTokenCount: 120,
          summaryTokenCount: 22,
          childNodeIds: [],
          supersededByNodeId: null,
          createdAt
        }
      ],
      maxAttachmentTextTokens: 8,
      memoriesEnabled: true,
      memoriesRigor: "high",
      memoryUserId: "user_golden",
      selectedMemories: [
        { id: "mem_tea", userId: "user_golden", content: "Likes tea", category: "work" as const, createdAt, updatedAt: createdAt }
      ]
    });
    expectGolden("conversation-base", prompt);
  });
});

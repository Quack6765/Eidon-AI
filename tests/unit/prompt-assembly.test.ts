import type { McpServer, PromptMessage, RuntimeProviderProfile, Skill } from "@/lib/types";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";
import {
  FORCED_DIRECT_ANSWER_DIRECTIVE,
  appendSystemCapabilitySegments,
  buildBotMentionDirective,
  buildDynamicSkillsSegment,
  buildForcedAnswerPromptMessages,
  buildInvokedSkillsDirective,
  buildStepPromptMessages,
  getEffectiveVisionMode,
  splitLateSystemMessages
} from "@/lib/prompt-assembly";

const resolveAttachmentPath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/attachments", () => ({
  resolveAttachmentPath
}));

function createSettings(overrides: Partial<RuntimeProviderProfile> = {}): RuntimeProviderProfile {
  return createRuntimeProviderProfile({
    id: "profile_test",
    name: "Test profile",
    model: "gpt-5-mini",
    systemPrompt: "Be exact.",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function mcpServer(overrides: Record<string, unknown> = {}): McpServer {
  return {
    id: "mcp_docs",
    slug: "docs",
    name: "Docs",
    url: "https://mcp.example.com",
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    isVisionMcp: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  } as McpServer;
}

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

const noCapabilities = {
  skills: [],
  mcpServers: [],
  mcpToolSets: [],
  hasWebSearch: false,
  parallelWebSearch: false,
  hasImageGeneration: false,
  effectiveVisionMode: "none" as const
};

function systemContent(messages: PromptMessage[]) {
  const system = messages.find((message) => message.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}

function trailingGuidance(messages: PromptMessage[]) {
  const last = messages.at(-1);
  return typeof last?.content === "string" ? last.content : "";
}

describe("prompt assembly", () => {
  beforeEach(() => {
    resolveAttachmentPath.mockReset();
    resolveAttachmentPath.mockImplementation(({ relativePath }: { relativePath: string }) => `/tmp/${relativePath}`);
  });

  describe("splitLateSystemMessages", () => {
    it("moves every system message after the first into guidance", () => {
      const split = splitLateSystemMessages([
        { role: "system", content: "base" },
        { role: "user", content: "hello" },
        { role: "system", content: "<memory>\nmem_1: [work] Likes tea\n</memory>" }
      ]);

      expect(split.promptMessages).toEqual([
        { role: "system", content: "base" },
        { role: "user", content: "hello" }
      ]);
      expect(split.guidance).toEqual(["<memory>\nmem_1: [work] Likes tea\n</memory>"]);
    });

    it("keeps a lone system message in place", () => {
      const split = splitLateSystemMessages([{ role: "system", content: "base" }]);
      expect(split.promptMessages).toEqual([{ role: "system", content: "base" }]);
      expect(split.guidance).toEqual([]);
    });
  });

  describe("appendSystemCapabilitySegments", () => {
    it("appends the base directives to an existing system message", () => {
      const messages = appendSystemCapabilitySegments({
        ...noCapabilities,
        promptMessages: [{ role: "system", content: "You are Eidon." }]
      });

      expect(messages).toHaveLength(1);
      expect(systemContent(messages)).toContain("You are Eidon.");
      expect(systemContent(messages)).toContain("<use_parallel_tool_calls>");
      expect(systemContent(messages)).toContain("Always prefer mermaid diagrams over ASCII art");
      expect(systemContent(messages)).toContain("## Markdown Formatting");
    });

    it("prepends a system message when the turn has none", () => {
      const messages = appendSystemCapabilitySegments({
        ...noCapabilities,
        promptMessages: [{ role: "user", content: "hi" }]
      });

      expect(messages[0]?.role).toBe("system");
      expect(messages[0]?.content).not.toContain("You are Eidon.");
      expect(systemContent(messages)).toContain("<use_parallel_tool_calls>");
      expect(messages[1]).toEqual({ role: "user", content: "hi" });
    });

    it("lists configured MCP servers and flags servers that require authentication", () => {
      const composio = mcpServer({ id: "mcp_composio", slug: "composio", name: "Composio" });
      const messages = appendSystemCapabilitySegments({
        ...noCapabilities,
        promptMessages: [{ role: "user", content: "Use Composio" }],
        mcpServers: [mcpServer(), composio],
        mcpToolSets: [
          { server: mcpServer(), tools: [] },
          { server: composio, tools: [], authRequired: true }
        ]
      });

      expect(systemContent(messages)).toContain("Configured MCP servers");
      expect(systemContent(messages)).toContain("- Docs");
      expect(systemContent(messages)).toContain("- Composio (requires authentication");
      expect(systemContent(messages)).toContain("Settings → MCP");
    });

    it("omits the capabilities segment when there are no skills, servers, or toolsets", () => {
      const messages = appendSystemCapabilitySegments({
        ...noCapabilities,
        promptMessages: [{ role: "user", content: "hi" }]
      });

      expect(systemContent(messages)).not.toContain("Configured MCP servers");
      expect(systemContent(messages)).not.toContain("Skills-first behavior");
    });

    it("omits vision-flagged servers from the capabilities message in native mode", () => {
      const visionServer = mcpServer({ id: "mcp_vision", name: "Vision MCP", isVisionMcp: true });
      const plainServer = mcpServer({ id: "mcp_plain", name: "Plain" });
      const messages = appendSystemCapabilitySegments({
        ...noCapabilities,
        effectiveVisionMode: "native",
        promptMessages: [{ role: "user", content: "hi" }],
        mcpServers: [visionServer, plainServer],
        mcpToolSets: [
          { server: visionServer, tools: [{ name: "analyze_image", description: "analyze", inputSchema: { type: "object" } }] },
          { server: plainServer, tools: [{ name: "do_thing", description: "do", inputSchema: { type: "object" } }] }
        ]
      });

      expect(systemContent(messages)).toContain("- Plain");
      expect(systemContent(messages)).not.toContain("- Vision MCP");
    });

    it("includes vision-flagged servers in the capabilities message in mcp mode", () => {
      const visionServer = mcpServer({ id: "mcp_vision", name: "Vision MCP", isVisionMcp: true });
      const messages = appendSystemCapabilitySegments({
        ...noCapabilities,
        effectiveVisionMode: "mcp",
        promptMessages: [{ role: "user", content: "hi" }],
        mcpServers: [visionServer],
        mcpToolSets: [{ server: visionServer, tools: [] }]
      });

      expect(systemContent(messages)).toContain("- Vision MCP");
    });

    it("adds the image tool policy directives only when image generation is configured", () => {
      const withImages = appendSystemCapabilitySegments({
        ...noCapabilities,
        hasImageGeneration: true,
        promptMessages: [{ role: "user", content: "draw" }]
      });
      expect(systemContent(withImages)).toContain("Images are produced only when the conversation calls for one");
      expect(systemContent(withImages)).toContain("Base the prompt and count on only the latest user image request");

      const withoutImages = appendSystemCapabilitySegments({
        ...noCapabilities,
        promptMessages: [{ role: "user", content: "draw" }]
      });
      expect(systemContent(withoutImages)).not.toContain("Images are produced only when the conversation calls for one");
    });

    it("adapts the web search guidance to the pipeline mode", () => {
      const parallel = appendSystemCapabilitySegments({
        ...noCapabilities,
        hasWebSearch: true,
        parallelWebSearch: true,
        promptMessages: [{ role: "user", content: "search" }],
        skills: [createSkill()]
      });
      expect(systemContent(parallel)).toContain("pass several distinct queries in a single web_search call");

      const sequential = appendSystemCapabilitySegments({
        ...noCapabilities,
        hasWebSearch: true,
        parallelWebSearch: false,
        promptMessages: [{ role: "user", content: "search" }],
        skills: [createSkill()]
      });
      expect(systemContent(sequential)).toContain("If you can answer confidently and accurately from your training data");
      expect(systemContent(sequential)).not.toContain("pass several distinct queries in a single web_search call");
    });
  });

  describe("buildDynamicSkillsSegment", () => {
    it("returns an empty segment when there are no skills and skill management is off", () => {
      expect(buildDynamicSkillsSegment([], false)).toBe("");
    });

    it("lists available skills with shared markers and lifecycle states", () => {
      const segment = buildDynamicSkillsSegment([
        createSkill(),
        createSkill({ id: "teamskill-curator", name: "Curator", description: "Shared curation skill." }),
        createSkill({ id: "skill_old", name: "Old", description: "Retired skill.", state: "archived" })
      ]);

      expect(segment).toContain("Available skills (metadata only — call load_skill to get full instructions):");
      expect(segment).toContain("- Release Notes: Use when writing customer-facing summaries of product changes.");
      expect(segment).toContain("- Curator (shared): Shared curation skill.");
      expect(segment).toContain("- Old [archived]: Retired skill.");
    });

    it("explains skill authoring when skill management is on and no skills exist yet", () => {
      const segment = buildDynamicSkillsSegment([], true);
      expect(segment).toContain("No skills are available yet.");
      expect(segment).toContain("load the skill-authoring skill first");
    });

    it("adds the shared-library guidance when skills exist and skill management is on", () => {
      const segment = buildDynamicSkillsSegment([createSkill()], true);
      expect(segment).toContain("Skills marked (shared) live in this team's shared library");
      expect(segment).toContain("Creation is the last resort.");
    });
  });

  describe("composer reference directives", () => {
    it("builds the invoked skills directive with each loaded skill body", () => {
      const directive = buildInvokedSkillsDirective(["Skill loaded: Release Notes\n\nInstructions."]);
      expect(directive).toBe(
        "The user invoked the skills below with / for this message. Their full instructions are already loaded: follow them for this request and do not call load_skill for them again.\n\nSkill loaded: Release Notes\n\nInstructions."
      );
    });

    it("builds the bot mention directive for every mentioned bot", () => {
      const directive = buildBotMentionDirective(["Writer", "Chief of Staff"]);
      expect(directive).toContain("The user addressed this message to @Writer, @Chief of Staff.");
      expect(directive).toContain("Hand the request off with message_bot");
    });
  });

  describe("getEffectiveVisionMode", () => {
    it("resolves each configured mode against the available vision servers and profiles", () => {
      expect(getEffectiveVisionMode(createSettings({ visionMode: "native" }), false)).toBe("native");
      expect(getEffectiveVisionMode(createSettings({ visionMode: "mcp" }), true)).toBe("mcp");
      expect(getEffectiveVisionMode(createSettings({ visionMode: "mcp" }), false)).toBe("none");
      expect(getEffectiveVisionMode(createSettings({ visionMode: "provider", visionProviderProfileId: "profile_vision" }), false)).toBe("provider");
      expect(getEffectiveVisionMode(createSettings({ visionMode: "provider" }), false)).toBe("none");
      expect(getEffectiveVisionMode(createSettings({ visionMode: "none" }), false)).toBe("none");
    });
  });

  describe("buildStepPromptMessages", () => {
    it("combines the dynamic skills segment, turn guidance, and vision guidance into one volatile trailing message", () => {
      const { promptMessages } = splitLateSystemMessages([
        { role: "system", content: "base" },
        { role: "user", content: "hello" },
        { role: "system", content: "<memory>\nmem_1: [work] Likes tea\n</memory>" }
      ]);
      const messages = buildStepPromptMessages({
        promptMessages,
        settings: createSettings(),
        skills: [createSkill()],
        turnGuidance: ["<memory>\nmem_1: [work] Likes tea\n</memory>", "Turn-scoped note."]
      });

      expect(messages).toHaveLength(3);
      expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
      expect(systemContent(messages)).not.toContain("Likes tea");
      const last = messages.at(-1)!;
      expect(last.role).toBe("user");
      expect(last.volatile).toBe(true);
      expect(trailingGuidance(messages)).toBe(
        "Available skills (metadata only — call load_skill to get full instructions):\n- Release Notes: Use when writing customer-facing summaries of product changes.\n\n<memory>\nmem_1: [work] Likes tea\n</memory>\n\nTurn-scoped note."
      );
    });

    it("returns the prompt unchanged when there is no guidance to append", () => {
      const promptMessages: PromptMessage[] = [{ role: "user", content: "hello" }];
      const messages = buildStepPromptMessages({
        promptMessages,
        settings: createSettings(),
        skills: [],
        turnGuidance: []
      });
      expect(messages).toBe(promptMessages);
    });

    it("replaces images with placeholders and lists attachment paths in provider vision mode", () => {
      const messages = buildStepPromptMessages({
        promptMessages: [imageMessage()],
        settings: createSettings({ visionMode: "provider", visionProviderProfileId: "profile_vision" }),
        skills: [],
        turnGuidance: []
      });

      expect(messages[0]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          { type: "text", text: "Attached image: att_photo_photo.png" }
        ]
      });
      expect(trailingGuidance(messages)).toContain("call the analyze_image tool with the absolute file paths");
      expect(trailingGuidance(messages)).toContain("- att_photo_photo.png (path: /tmp/conv_vision/att_photo_photo.png)");
    });

    it("lists vision MCP servers and attachment paths in mcp vision mode", () => {
      const visionServer = mcpServer({ id: "vision_server", name: "Vision MCP", isVisionMcp: true });
      const messages = buildStepPromptMessages({
        promptMessages: [imageMessage()],
        settings: createSettings({ visionMode: "mcp" }),
        visionMcpServers: [visionServer],
        skills: [],
        turnGuidance: []
      });

      expect(systemContent(messages)).not.toContain("Vision MCP servers:");
      expect(trailingGuidance(messages)).toContain("Vision MCP servers:");
      expect(trailingGuidance(messages)).toContain("- Vision MCP");
      expect(trailingGuidance(messages)).toContain("- att_photo_photo.png (path: /tmp/conv_vision/att_photo_photo.png)");
      expect(messages[0]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          { type: "text", text: "Attached image: att_photo_photo.png" }
        ]
      });
    });

    it("keeps images inline and adds no vision guidance in native mode", () => {
      const messages = buildStepPromptMessages({
        promptMessages: [imageMessage()],
        settings: createSettings({ visionMode: "native" }),
        skills: [],
        turnGuidance: []
      });

      expect(messages).toEqual([imageMessage()]);
    });

    it("falls back to the non-native vision notice when no vision backend is configured", () => {
      const messages = buildStepPromptMessages({
        promptMessages: [imageMessage()],
        settings: createSettings({ visionMode: "mcp" }),
        skills: [],
        turnGuidance: []
      });

      expect(trailingGuidance(messages)).toContain("The current model configuration cannot inspect attached images directly in this turn");
      expect(messages[0]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          { type: "text", text: "Attached image: att_photo_photo.png" }
        ]
      });
    });
  });

  describe("buildForcedAnswerPromptMessages", () => {
    it("appends the default stop directive after the guidance", () => {
      const messages = buildForcedAnswerPromptMessages({
        promptMessages: [{ role: "user", content: "Loop forever" }],
        settings: createSettings(),
        guidance: ["Turn-scoped note."]
      });

      expect(trailingGuidance(messages)).toBe(`Turn-scoped note.\n\n${FORCED_DIRECT_ANSWER_DIRECTIVE}`);
      expect(messages.at(-1)?.volatile).toBe(true);
    });

    it("uses the provided directive instead of the default", () => {
      const messages = buildForcedAnswerPromptMessages({
        promptMessages: [{ role: "user", content: "Loop forever" }],
        settings: createSettings(),
        guidance: [],
        directive: "Write the final research report."
      });

      expect(trailingGuidance(messages)).toBe("Write the final research report.");
    });
  });
});

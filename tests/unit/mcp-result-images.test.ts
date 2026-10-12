import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listAttachmentsForConversation } from "@/lib/attachments";
import { createConversation, createMessage, getMessage } from "@/lib/conversations";
import { executeMcpToolCall } from "@/lib/tool-executors";
import { setUserAllowAllTools } from "@/lib/user-preferences";
import { createLocalUser } from "@/lib/users";
import type { McpServer, McpTool, McpToolCallResult, PromptMessage } from "@/lib/types";

const mcpMocks = vi.hoisted(() => ({
  callMcpTool: vi.fn()
}));

vi.mock("@/lib/mcp-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp-client")>();
  return {
    ...actual,
    callMcpTool: mcpMocks.callMcpTool
  };
});

const server: McpServer = {
  id: "srv_images",
  name: "Image Server",
  slug: "image_server",
  url: "http://localhost:9999",
  headers: {},
  transport: "streamable_http",
  command: null,
  args: null,
  env: null,
  enabled: true,
  isVisionMcp: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const tool: McpTool = {
  name: "render",
  description: "Render an image",
  inputSchema: { type: "object", properties: {} }
};

async function setup() {
  const user = await createLocalUser({ username: "mcp-image-user", password: "Password123!", role: "user" });
  setUserAllowAllTools(user.id, true);
  const conversation = createConversation(undefined, undefined, undefined, user.id);
  const message = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "streaming",
    estimatedTokens: 0
  });
  return { userId: user.id, conversationId: conversation.id, messageId: message.id };
}

async function runTool(
  result: McpToolCallResult,
  input: { userId: string; conversationId: string; assistantMessageId?: string }
) {
  mcpMocks.callMcpTool.mockResolvedValue(result);
  const outcome = await executeMcpToolCall(
    "call_render",
    "mcp_image_server_render",
    {},
    {
      input: {
        mcpToolSets: [{ server, tools: [tool] }],
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolApproval: { userId: input.userId, unattended: true }
      },
      successfulReadOnlyToolResults: new Map(),
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    }
  );
  return JSON.stringify(outcome.promptMessages.at(-1));
}

describe("MCP tool result images", () => {
  beforeEach(() => {
    mcpMocks.callMcpTool.mockReset();
  });

  it("attaches returned images to the assistant message and tells the model they are shown", async () => {
    const { userId, conversationId, messageId } = await setup();
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#ff0000" }
    }).png().toBuffer();

    const modelText = await runTool(
      {
        content: [
          { type: "text", text: "Rendered prompt 42" },
          { type: "image", data: png.toString("base64"), mimeType: "image/png" }
        ]
      },
      { userId, conversationId, assistantMessageId: messageId }
    );

    const attachments = getMessage(messageId)?.attachments ?? [];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(attachments[0].filename).toMatch(/\.png$/);
    expect(modelText).toContain("Rendered prompt 42");
    expect(modelText).toContain(`[image attached to your reply as ${attachments[0].filename};`);
    expect(modelText).not.toContain("[image image/png]");
  });

  it("keeps the placeholder for image data that is not a supported raster image", async () => {
    const { userId, conversationId, messageId } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const modelText = await runTool(
      { content: [{ type: "image", data: svg.toString("base64"), mimeType: "image/png" }] },
      { userId, conversationId, assistantMessageId: messageId }
    );

    expect(listAttachmentsForConversation(conversationId)).toEqual([]);
    expect(modelText).toContain("[image image/png]");
  });

  it("does not attach images when the call has no assistant message", async () => {
    const { userId, conversationId } = await setup();
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#00ff00" }
    }).png().toBuffer();

    const modelText = await runTool(
      { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }] },
      { userId, conversationId }
    );

    expect(listAttachmentsForConversation(conversationId)).toEqual([]);
    expect(modelText).toContain("[image image/png]");
  });
});

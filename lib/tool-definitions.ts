import { extractEnumHints } from "@/lib/tool-schema-helpers";
import { getWebSearchActionLabel, isBuiltinWebSearchServer } from "@/lib/web-search";
import { getSkillResolvedName, getSkillResolvedDescription } from "./prompt-analysis";
import type { McpServer, McpTool, Skill, ToolDefinition, VisionMode } from "@/lib/types";

export type ToolSet = {
  server: McpServer;
  tools: McpTool[];
};

export function mcpToolFunctionName(serverSlug: string, toolName: string) {
  return `mcp_${serverSlug}_${toolName}`;
}

export function getToolLabel(tool: McpTool) {
  return tool.title ?? tool.annotations?.title ?? tool.name;
}

export function buildArgumentsSummary(args: Record<string, unknown> | null | undefined) {
  if (!args || !Object.keys(args).length) return "";
  const firstScalar = Object.entries(args).find(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  if (firstScalar) return `${firstScalar[0]}=${String(firstScalar[1])}`;
  const json = JSON.stringify(args);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

export function buildShellDetail(command: string) {
  return command.length > 140 ? `${command.slice(0, 137)}...` : command;
}

export function buildToolDefinitions(input: {
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  memoriesEnabled: boolean;
  searxngBaseUrl?: string | null;
  imageGenerationBackend?: string | null;
  imageGenerationToolEnabled?: boolean;
  restrictToGenerateImage?: boolean;
  effectiveVisionMode: VisionMode;
}): ToolDefinition[] {
  const imageTool =
    input.imageGenerationToolEnabled !== false &&
    input.imageGenerationBackend &&
    input.imageGenerationBackend !== "disabled"
      ? {
          type: "function" as const,
          function: {
            name: "generate_image",
            description: "Generate an image from a text prompt. Base the prompt and count on only the latest user image request unless the user explicitly asks to modify or combine earlier results. Returns generated images as attachments on the response.",
            parameters: {
              type: "object" as const,
              properties: {
                prompt: { type: "string", description: "Detailed image generation prompt for the latest user request only" },
                negative_prompt: { type: "string", description: "Things to exclude from the image" },
                aspect_ratio: {
                  type: "string",
                  enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
                  description: "Desired aspect ratio (default 1:1)"
                },
                count: { type: "number", description: "Number of images to generate (1-4, default 1)" }
              },
              required: ["prompt"]
            }
          }
        }
      : null;

  if (input.restrictToGenerateImage) {
    return imageTool ? [imageTool] : [];
  }

  const tools: ToolDefinition[] = [];

  const webSearchDirective = "Only use this tool for recent events, time-sensitive information, or topics you are uncertain about. Prefer your own knowledge when you can answer confidently.";

  for (const { server, tools: mcpTools } of input.mcpToolSets) {
    if (server.isVisionMcp && input.effectiveVisionMode !== "mcp") {
      continue;
    }
    for (const tool of mcpTools) {
      const enumHints = extractEnumHints(tool.inputSchema ?? {});
      tools.push({
        type: "function",
        function: {
          name: mcpToolFunctionName(server.slug, tool.name),
          description: [
            tool.annotations?.title ?? tool.name,
            tool.description,
            enumHints || undefined,
            tool.annotations?.readOnlyHint ? "(read-only)" : undefined,
            isBuiltinWebSearchServer(server) ? webSearchDirective : undefined
          ].filter(Boolean).join(" — "),
          parameters: (tool.inputSchema as ToolDefinition["function"]["parameters"]) ?? { type: "object", properties: {} }
        }
      });
    }
  }

  if (input.skills.length) {
    tools.push({
      type: "function",
      function: {
        name: "load_skill",
        description: `Load the full content and instructions of a skill. Available: ${input.skills.map((s) => getSkillResolvedName(s)).join(", ")}`,
        parameters: {
          type: "object",
          properties: {
            skill_name: { type: "string", description: "Name of the skill to load" }
          },
          required: ["skill_name"]
        }
      }
    });
  }

  tools.push({
    type: "function",
    function: {
      name: "execute_shell_command",
      description: "Execute a local shell command on the host environment.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute" },
          timeout_ms: { type: "number", description: "Timeout in milliseconds (default 30000)" }
        },
        required: ["command"]
      }
    }
  });

  if (input.searxngBaseUrl) {
    tools.push({
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web using the configured SearXNG instance. Only use this tool for recent events, time-sensitive information, or topics you are uncertain about. Prefer your own knowledge when you can answer confidently.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (default 5, max 10)"
            }
          },
          required: ["query"]
        }
      }
    });
  }

  if (imageTool) {
    tools.push(imageTool);
  }

  if (input.memoriesEnabled) {
    tools.push(
      {
        type: "function",
        function: {
          name: "create_memory",
          description: "Save a durable fact about the user for future conversations. Use conservatively — only for facts likely to recur (name, location, preferences, work details). Do not save transient task details.",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "The fact to remember" },
              category: { type: "string", description: "One of: personal, preference, work, location, other" }
            },
            required: ["content", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_memory",
          description: "Update an existing memory when a fact has changed.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "The memory ID to update" },
              content: { type: "string", description: "The updated fact" },
              category: { type: "string", description: "New category (optional)" }
            },
            required: ["id", "content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delete_memory",
          description: "Delete a stored memory that is no longer relevant or accurate.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "The memory ID to delete" }
            },
            required: ["id"]
          }
        }
      }
    );
  }

  return tools;
}

import { buildCreateMemoryDescription } from "@/lib/memory-guidance";
import { buildCreateAutomationDescription } from "@/lib/automation-guidance";
import { extractEnumHints } from "@/lib/tool-schema-helpers";
import { getSkillResolvedName } from "./skill-runtime";
import type { BotRosterEntry } from "@/lib/bots";
import type { WebSearchPipelineMode } from "@/lib/web-search-catalog";
import type { McpServer, McpTool, MemoryRigor, Skill, ToolDefinition, VisionMode } from "@/lib/types";

export type ToolSet = {
  server: McpServer;
  tools: McpTool[];
  authRequired?: boolean;
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
  memoriesRigor?: MemoryRigor;
  webSearchEnabled?: boolean;
  webSearchPipelineMode?: WebSearchPipelineMode;
  imageGenerationProviderId?: string | null;
  imageGenerationToolEnabled?: boolean;
  restrictToGenerateImage?: boolean;
  effectiveVisionMode: VisionMode;
  visionToolEnabled?: boolean;
  botTeam?: {
    isChief: boolean;
    roster: BotRosterEntry[];
  };
  semanticRecallAvailable?: boolean;
}): ToolDefinition[] {
  const imageTool =
    input.imageGenerationToolEnabled !== false &&
    input.imageGenerationProviderId &&
    input.imageGenerationProviderId !== "disabled"
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
            tool.annotations?.readOnlyHint ? "(read-only)" : undefined
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

  if (input.visionToolEnabled) {
    tools.push({
      type: "function",
      function: {
        name: "analyze_image",
        description: "Analyze attached images using a vision-capable model. Use the absolute file paths listed in the system message and include an optional question about the images. Returns a text description from the vision model.",
        parameters: {
          type: "object",
          properties: {
            file_paths: {
              type: "array",
              items: { type: "string" },
              maxItems: 10,
              description: "Absolute file paths of the images to analyze (from the attachment list in the system message)"
            },
            question: {
              type: "string",
              description: "Optional question to answer about the images"
            }
          },
          required: ["file_paths"]
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

  tools.push({
    type: "function",
    function: {
      name: "create_automation",
      description: buildCreateAutomationDescription(),
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name for the automation (max 100 chars)" },
          prompt: {
            type: "string",
            description:
              "Complete, self-contained instructions the scheduled run will execute. Supports the variables {{date}} (run date), {{run_number}} (1-based ordinal of this run), and {{last_result}} (result of the previous run, empty on the first run)."
          },
          schedule_kind: {
            type: "string",
            enum: ["interval", "calendar"],
            description: "interval = every N minutes; calendar = daily or weekly at a local time"
          },
          interval_minutes: {
            type: "number",
            description: "Minutes between runs for interval schedules (minimum 5)"
          },
          calendar_frequency: {
            type: "string",
            enum: ["daily", "weekly"],
            description: "Calendar frequency (required for calendar schedules)"
          },
          time_of_day: {
            type: "string",
            description: "Run time in HH:MM 24h local format (required for calendar schedules)"
          },
          days_of_week: {
            type: "array",
            items: { type: "number" },
            description: "Weekdays for weekly schedules, 0=Sunday through 6=Saturday"
          },
          continue_previous_conversation: {
            type: "boolean",
            description:
              "true = each run continues the previous run's conversation so briefs build on prior results; false (default) = each run starts a fresh conversation"
          }
        },
        required: ["name", "prompt", "schedule_kind"]
      }
    }
  });

  if (input.botTeam) {
    const rosterSummary = input.botTeam.roster.length
      ? input.botTeam.roster
          .map((bot) => `- ${bot.name}${bot.isChief ? " — chief of staff" : ""}${bot.title ? ` (${bot.title})` : ""}${bot.description ? `: ${bot.description}` : ""}`)
          .join("\n")
      : "(no other bots yet)";

    tools.push({
      type: "function",
      function: {
        name: "message_bot",
        description:
          "Send a message to another bot on the team. Returns immediately — the bot works on it in the background in its own conversation with its own browser session and workspace, and its reply arrives here as a new message when it finishes. After sending, say right away what you asked and that you will report back once you have the answer, then continue with other work. When the reply arrives as a new message, report it to the user directly — never message the bot back just to acknowledge or forward its reply. Bots you can message:\n" +
          rosterSummary,
        parameters: {
          type: "object",
          properties: {
            bot: {
              type: "string",
              description: "Name or id of another bot on the team (not yourself)"
            },
            message: {
              type: "string",
              description: "Complete, self-contained message or instructions for the bot"
            }
          },
          required: ["bot", "message"]
        }
      }
    });

    if (input.botTeam.isChief) {
      tools.push(
        {
          type: "function",
          function: {
            name: "create_bot",
            description:
              "Create a new specialist bot when a job deserves a long-lived owner and no existing bot fits. Only call this after the user has explicitly confirmed the creation in this conversation. After creation, send work to it with message_bot.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Short unique name for the bot" },
                title: { type: "string", description: "One-line job title (optional)" },
                description: {
                  type: "string",
                  description: "What this bot owns and how it should work (optional)"
                }
              },
              required: ["name"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "update_bot",
            description:
              "Update an existing specialist bot when its responsibilities change: rename it, or revise its title, description, or system prompt. Prefer this over creating a duplicate bot.",
            parameters: {
              type: "object",
              properties: {
                bot: {
                  type: "string",
                  description: "Name or id of the specialist bot to update (not yourself)"
                },
                name: { type: "string", description: "New unique name for the bot (optional)" },
                title: { type: "string", description: "New one-line job title (optional)" },
                description: {
                  type: "string",
                  description: "New description of what this bot owns (optional)"
                },
                system_prompt: {
                  type: "string",
                  description: "New base system prompt shaping how the bot works (optional)"
                }
              },
              required: ["bot"]
            }
          }
        }
      );
    }
  }

  if (input.webSearchEnabled) {
    const parallelSearch = (input.webSearchPipelineMode ?? "auto") !== "off";
    tools.push({
      type: "function",
      function: {
        name: "web_search",
        description: parallelSearch
          ? "Search the web using the configured provider. Pass multiple distinct queries in `queries` when the question has several facets or complementary phrasings — they run in parallel and their results are merged. A single complex query is automatically decomposed into parallel sub-queries. Provide every facet query needed to answer in this single call — one comprehensive call is much faster for the user than multiple sequential search rounds. Only use this tool for recent events, time-sensitive information, or topics you are uncertain about. Prefer your own knowledge when you can answer confidently."
          : "Search the web using the configured provider. Only use this tool for recent events, time-sensitive information, or topics you are uncertain about. Prefer your own knowledge when you can answer confidently.",
        parameters: parallelSearch
          ? {
              type: "object",
              properties: {
                query: { type: "string", description: "Single search query" },
                queries: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  maxItems: 5,
                  description: "Multiple distinct search queries to run in parallel; each should target a different facet of the question"
                },
                max_results: {
                  type: "number",
                  description: "Maximum number of results to return per query (default 5, max 10)"
                }
              }
            }
          : {
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

  if (input.semanticRecallAvailable) {
    tools.push({
      type: "function",
      function: {
        name: "search_workspace",
        description:
          "Semantically search this user's own workspace: saved memories, past conversations (including automation transcripts), conversation summaries, and attached document text. Use it when the user refers to something discussed before, a past decision, or a document they shared, and the answer is not already in the current conversation. Read-only.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural-language description of what to find" },
            limit: { type: "number", description: "Maximum number of results (default 8, max 20)" }
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
          description: buildCreateMemoryDescription(input.memoriesRigor ?? "balanced"),
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

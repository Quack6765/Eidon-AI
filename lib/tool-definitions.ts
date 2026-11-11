import type { McpServer, McpTool } from "@/lib/types";

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

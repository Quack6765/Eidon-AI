import type { ToolApprovalProposalPayload } from "@/lib/types";

export function buildToolApprovalPromptHeading(payload: ToolApprovalProposalPayload) {
  if (payload.scope === "mcp") {
    return `Allow "${payload.mcpToolName ?? "tool"}" from ${payload.mcpServerName ?? "MCP server"}?`;
  }

  if (!payload.classified || !payload.families.length) {
    return "Allow this command?";
  }

  if (payload.families.length === 1) {
    return `Allow "${payload.families[0]}" commands?`;
  }

  const names = payload.families.map((family) => `"${family}"`);
  const lastName = names.pop();
  return `Allow ${names.join(", ")} and ${lastName} commands?`;
}

export function buildToolApprovalHeading(payload: ToolApprovalProposalPayload) {
  if (payload.resolution === "once") return "Allowed once";
  if (payload.resolution === "always") return "Always allowed";
  if (payload.resolution === "denied") return "Denied";
  if (payload.resolution === "expired") return "Request expired";
  if (payload.resolution === "stopped") return "Request stopped";
  return buildToolApprovalPromptHeading(payload);
}

export function buildToolApprovalNote(payload: ToolApprovalProposalPayload) {
  if (payload.resolution) {
    return "";
  }

  if (payload.scope === "mcp") {
    return `Approving allows every future call of "${payload.mcpToolName ?? "tool"}", whatever its arguments.`;
  }

  if (!payload.classified || !payload.families.length) {
    return "This command could not be classified into a command family, so it can only be allowed once.";
  }

  const familyList = payload.families.map((family) => `"${family}"`).join(", ");
  return `Approving allows the ${familyList} command ${payload.families.length === 1 ? "family" : "families"} — every such command, whatever its arguments.`;
}

export function getToolApprovalPreview(payload: ToolApprovalProposalPayload) {
  if (payload.scope === "shell") {
    return payload.command ?? "";
  }

  const args = JSON.stringify(payload.arguments ?? {}, null, 2);
  return args === "{}"
    ? payload.mcpToolName ?? ""
    : `${payload.mcpToolName ?? ""}\n${args}`;
}

import { describe, expect, it } from "vitest";
import {
  TOOL_TRAITS,
  getToolTraits,
  isProposalToolCall,
  proposalActionKinds,
  toolNamesWithTrait
} from "@/lib/tool-traits";

describe("tool traits", () => {
  it("marks exactly the tools the runtime treats as parallelizable", () => {
    expect(toolNamesWithTrait("parallelizable")).toEqual(
      new Set(["web_search", "read_page", "search_workspace", "analyze_image", "load_skill", "message_bot", "check_bot"])
    );
  });

  it("marks exactly the proposal-style tools", () => {
    expect(toolNamesWithTrait("proposal")).toEqual(
      new Set(["create_memory", "update_memory", "delete_memory", "create_automation", "draft_message"])
    );
    for (const name of ["create_memory", "update_memory", "delete_memory", "create_automation", "draft_message"]) {
      expect(isProposalToolCall(name)).toBe(true);
    }
    expect(isProposalToolCall("web_search")).toBe(false);
    expect(isProposalToolCall("request_takeover")).toBe(false);
  });

  it("derives the summary's proposal action kinds", () => {
    expect(new Set(proposalActionKinds())).toEqual(
      new Set([
        "create_memory",
        "update_memory",
        "delete_memory",
        "create_automation",
        "draft_message",
        "computer_handoff",
        "secret_request"
      ])
    );
  });

  it("derives the memory proposal kinds", () => {
    expect(toolNamesWithTrait("memoryProposal")).toEqual(new Set(["create_memory", "update_memory", "delete_memory"]));
  });

  it("restricts the once-per-turn rule to generate_image", () => {
    expect(toolNamesWithTrait("oncePerTurn")).toEqual(new Set(["generate_image"]));
  });

  it("returns empty traits for unknown tools", () => {
    expect(getToolTraits("mcp_unknown_tool")).toEqual({});
    expect(getToolTraits("")).toEqual({});
  });

  it("keeps one entry per built-in tool name", () => {
    expect(Object.keys(TOOL_TRAITS).sort()).toEqual(
      [
        "draft_message",
        "load_skill",
        "skill_manage",
        "analyze_image",
        "execute_shell_command",
        "run_python",
        "create_automation",
        "request_takeover",
        "request_secret",
        "list_secrets",
        "save_secret",
        "message_bot",
        "check_bot",
        "update_own_instructions",
        "create_bot",
        "update_bot",
        "web_search",
        "read_page",
        "search_workspace",
        "generate_image",
        "create_memory",
        "update_memory",
        "delete_memory"
      ].sort()
    );
  });
});

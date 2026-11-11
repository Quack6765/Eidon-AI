import type { MessageActionKind } from "@/lib/types";

export type PostSuccessGuidance = "web-search" | "image-generation";

export type ToolTraits = {
  parallelizable?: boolean;
  proposal?: boolean;
  oncePerTurn?: boolean;
  postSuccessGuidance?: PostSuccessGuidance;
  memoryProposal?: boolean;
  proposalActionKind?: MessageActionKind;
};

export const TOOL_TRAITS: Record<string, ToolTraits> = {
  draft_message: { proposal: true, proposalActionKind: "draft_message" },
  load_skill: { parallelizable: true },
  skill_manage: {},
  analyze_image: { parallelizable: true },
  execute_shell_command: {},
  run_python: {},
  create_automation: { proposal: true, proposalActionKind: "create_automation" },
  request_takeover: { proposalActionKind: "computer_handoff" },
  request_secret: { proposalActionKind: "secret_request" },
  list_secrets: {},
  save_secret: {},
  message_bot: { parallelizable: true },
  check_bot: { parallelizable: true },
  update_own_instructions: {},
  create_bot: {},
  update_bot: {},
  web_search: { parallelizable: true, postSuccessGuidance: "web-search" },
  read_page: { parallelizable: true },
  search_workspace: { parallelizable: true },
  generate_image: { oncePerTurn: true, postSuccessGuidance: "image-generation" },
  create_memory: { proposal: true, memoryProposal: true, proposalActionKind: "create_memory" },
  update_memory: { proposal: true, memoryProposal: true, proposalActionKind: "update_memory" },
  delete_memory: { proposal: true, memoryProposal: true, proposalActionKind: "delete_memory" }
};

export function getToolTraits(name: string): ToolTraits {
  return TOOL_TRAITS[name] ?? {};
}

export function isProposalToolCall(name: string) {
  return getToolTraits(name).proposal === true;
}

export function toolNamesWithTrait(trait: keyof ToolTraits): Set<string> {
  return new Set(
    Object.entries(TOOL_TRAITS)
      .filter(([, traits]) => Boolean(traits[trait]))
      .map(([name]) => name)
  );
}

export function proposalActionKinds(): MessageActionKind[] {
  return Object.values(TOOL_TRAITS).flatMap((traits) =>
    traits.proposalActionKind ? [traits.proposalActionKind] : []
  );
}

import type { MemoryCategory, MemoryProposalPayload, UserMemory } from "@/lib/types";

const VALID_MEMORY_CATEGORIES: MemoryCategory[] = [
  "personal",
  "preference",
  "work",
  "location",
  "other"
];

function toProposalMemorySnapshot(memory: UserMemory) {
  return {
    id: memory.id,
    content: memory.content,
    category: memory.category
  };
}

export function normalizeMemoryCategory(category: unknown): MemoryCategory {
  return typeof category === "string" && VALID_MEMORY_CATEGORIES.includes(category as MemoryCategory)
    ? (category as MemoryCategory)
    : "other";
}

export function buildCreateMemoryProposal(input: {
  content: string;
  category: unknown;
}): MemoryProposalPayload {
  return {
    operation: "create",
    targetMemoryId: null,
    proposedMemory: {
      content: input.content.trim(),
      category: normalizeMemoryCategory(input.category)
    }
  };
}

export function buildUpdateMemoryProposal(input: {
  memory: UserMemory;
  content: string;
  category?: unknown;
}): MemoryProposalPayload {
  return {
    operation: "update",
    targetMemoryId: input.memory.id,
    currentMemory: toProposalMemorySnapshot(input.memory),
    proposedMemory: {
      content: input.content.trim(),
      category: input.category === undefined
        ? input.memory.category
        : normalizeMemoryCategory(input.category)
    }
  };
}

export function buildDeleteMemoryProposal(memory: UserMemory): MemoryProposalPayload {
  return {
    operation: "delete",
    targetMemoryId: memory.id,
    currentMemory: toProposalMemorySnapshot(memory)
  };
}

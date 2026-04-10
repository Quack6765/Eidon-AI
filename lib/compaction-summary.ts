import type { MemoryNode } from "@/lib/types";

export const COMPACTION_SUMMARY_HEADINGS = [
  "Goal",
  "Constraints",
  "Actions Taken",
  "Outcomes",
  "Open Tasks",
  "Artifact References",
  "Time Span"
] as const;

export type CompactionSummaryHeading = (typeof COMPACTION_SUMMARY_HEADINGS)[number];

export type CompactionSummarySections = Record<CompactionSummaryHeading, string[]>;

export type ParsedCompactionSummary = {
  sections: CompactionSummarySections;
};

type SummaryPromptSourceSpan = {
  startMessageId: string;
  endMessageId: string;
  messageCount: number;
};

type SummaryPromptInput = {
  label: string;
  blocks: string;
  sourceSpan: SummaryPromptSourceSpan;
  existingSummary?: string;
};

type SummarySelectionInput = {
  activeNodes: MemoryNode[];
  latestUserMessage: string;
  summaryTokenBudget: number;
};

function createEmptySections(): CompactionSummarySections {
  return {
    Goal: [],
    Constraints: [],
    "Actions Taken": [],
    Outcomes: [],
    "Open Tasks": [],
    "Artifact References": [],
    "Time Span": []
  };
}

function normalizeSummaryItem(value: string): string {
  return value
    .replace(/^[>*•\-]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderSummaryItem(value: string): boolean {
  return /^(none|n\/a|na|not applicable|no items?|no tasks?|nothing)$/i.test(value.trim());
}

function parseSummaryLines(content: string): CompactionSummarySections {
  const sections = createEmptySections();
  let activeHeading: CompactionSummaryHeading | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const heading = COMPACTION_SUMMARY_HEADINGS.find((candidate) => line === `${candidate}:`);
    if (heading) {
      activeHeading = heading;
      continue;
    }

    if (!activeHeading) {
      continue;
    }

    const item = normalizeSummaryItem(line);
    if (!item || isPlaceholderSummaryItem(item)) {
      continue;
    }

    sections[activeHeading].push(item);
  }

  return sections;
}

export function parseCompactionSummary(content: string): ParsedCompactionSummary {
  return {
    sections: parseSummaryLines(content)
  };
}

export function extractOpenTasks(content: string): string[] {
  return parseCompactionSummary(content).sections["Open Tasks"];
}

export function extractArtifactReferences(content: string): string[] {
  return parseCompactionSummary(content).sections["Artifact References"];
}

function normalizeArtifactReference(value: string): string {
  return value
    .trim()
    .replace(/^[`"'[\](){}<>]+/, "")
    .replace(/[`"'.,;:!?]+$/, "")
    .replace(/#L\d+(?:C\d+)?$/i, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .toLowerCase();
}

function artifactReferenceMatchesUserMessage(userMessage: string, reference: string): boolean {
  const normalizedUser = normalizeArtifactReference(userMessage).replace(/\s+/g, " ");
  const normalizedReference = normalizeArtifactReference(reference).replace(/\s+/g, " ");

  if (!normalizedReference) {
    return false;
  }

  if (normalizedUser.includes(normalizedReference)) {
    return true;
  }

  const pathSegments = normalizedReference.split(/[\\/]/).filter(Boolean);
  const basename = pathSegments.at(-1);
  if (basename && basename !== normalizedReference && normalizedUser.includes(basename)) {
    return true;
  }

  const tail = pathSegments.slice(-2).join("/");
  if (tail && tail !== normalizedReference && normalizedUser.includes(tail)) {
    return true;
  }

  if (/^https?:\/\//i.test(reference)) {
    try {
      const url = new URL(reference);
      const normalizedUrl = normalizeArtifactReference(`${url.host}${url.pathname}`).replace(/\s+/g, " ");
      if (normalizedUser.includes(normalizedUrl)) {
        return true;
      }
      const urlTail = url.pathname.split("/").filter(Boolean).at(-1);
      if (urlTail && normalizedUser.includes(urlTail.toLowerCase())) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

function rankNodes(
  activeNodes: MemoryNode[],
  latestUserMessage: string
): Array<{
  node: MemoryNode;
  openTaskCount: number;
  artifactMatchCount: number;
}> {
  return activeNodes.map((node) => {
    const parsed = parseCompactionSummary(node.content);
    const openTaskCount = parsed.sections["Open Tasks"].length;
    const artifactMatchCount = parsed.sections["Artifact References"].filter((reference) =>
      artifactReferenceMatchesUserMessage(latestUserMessage, reference)
    ).length;

    return {
      node,
      openTaskCount,
      artifactMatchCount
    };
  });
}

function compareByPriority(a: MemoryNode, b: MemoryNode): number {
  if (b.depth !== a.depth) {
    return b.depth - a.depth;
  }

  const aTime = new Date(a.createdAt).getTime();
  const bTime = new Date(b.createdAt).getTime();
  if (bTime !== aTime) {
    return bTime - aTime;
  }

  return a.id.localeCompare(b.id);
}

function compareByRecency(a: MemoryNode, b: MemoryNode): number {
  if (b.depth !== a.depth) {
    return b.depth - a.depth;
  }

  const aTime = new Date(a.createdAt).getTime();
  const bTime = new Date(b.createdAt).getTime();
  if (bTime !== aTime) {
    return bTime - aTime;
  }

  return a.id.localeCompare(b.id);
}

function pickWithinBudget(
  nodes: MemoryNode[],
  budget: number,
  selectedIds: Set<string>
): { selected: MemoryNode[]; remainingBudget: number } {
  const selected: MemoryNode[] = [];
  let remainingBudget = Math.max(0, budget);

  for (const node of nodes) {
    if (selectedIds.has(node.id)) {
      continue;
    }

    const nodeTokens = Math.max(0, node.summaryTokenCount);
    if (nodeTokens > remainingBudget) {
      continue;
    }

    selected.push(node);
    selectedIds.add(node.id);
    remainingBudget -= nodeTokens;
  }

  return { selected, remainingBudget };
}

export function selectCompactionMemoryNodes(input: SummarySelectionInput): MemoryNode[] {
  if (!input.activeNodes.length || input.summaryTokenBudget <= 0) {
    return [];
  }

  const ranked = rankNodes(input.activeNodes, input.latestUserMessage);
  const openTaskNodes = ranked
    .filter((entry) => entry.openTaskCount > 0)
    .map((entry) => entry.node)
    .sort(compareByPriority);

  const artifactNodes = ranked
    .filter((entry) => entry.openTaskCount === 0 && entry.artifactMatchCount > 0)
    .map((entry) => entry.node)
    .sort(compareByPriority);

  const recencyNodes = ranked
    .filter((entry) => entry.openTaskCount === 0 && entry.artifactMatchCount === 0)
    .map((entry) => entry.node)
    .sort(compareByRecency);

  const selectedIds = new Set<string>();
  const selected: MemoryNode[] = [];
  let remainingBudget = input.summaryTokenBudget;

  for (const group of [openTaskNodes, artifactNodes, recencyNodes]) {
    const result = pickWithinBudget(group, remainingBudget, selectedIds);
    selected.push(...result.selected);
    remainingBudget = result.remainingBudget;
  }

  return selected;
}

export function buildCompactionSummaryPromptBody(input: SummaryPromptInput): string {
  if (input.existingSummary) {
    return [
      "You are updating this existing conversation summary.",
      "",
      "EXISTING SUMMARY (for context):",
      input.existingSummary,
      "",
      "NEW MESSAGES:",
      input.blocks,
      "",
      "Rewrite the summary using these exact headings and this exact order:",
      "Goal:",
      "Constraints:",
      "Actions Taken:",
      "Outcomes:",
      "Open Tasks:",
      "Artifact References:",
      "Time Span:",
      "",
      "Use short bullet points under each heading.",
      "If a section has nothing to add, write '- None'.",
      "Do not add any other headings or preamble.",
      "",
      `sourceSpan: startMessageId="${input.sourceSpan.startMessageId}", endMessageId="${input.sourceSpan.endMessageId}", messageCount=${input.sourceSpan.messageCount}`,
      ""
    ].join("\n");
  }

  return [
    `You are compacting ${input.label} for a chat memory engine.`,
    "",
    "Rewrite the summary using these exact headings and this exact order:",
    "Goal:",
    "Constraints:",
    "Actions Taken:",
    "Outcomes:",
    "Open Tasks:",
    "Artifact References:",
    "Time Span:",
    "",
    "Use short bullet points under each heading.",
    "If a section has nothing to add, write '- None'.",
    "Do not add any other headings or preamble.",
    "",
    input.blocks,
    "",
    `sourceSpan: startMessageId="${input.sourceSpan.startMessageId}", endMessageId="${input.sourceSpan.endMessageId}", messageCount=${input.sourceSpan.messageCount}`,
    ""
  ].join("\n");
}

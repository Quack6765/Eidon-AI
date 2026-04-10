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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function stripHeadingDecorators(line: string): string {
  return line
    .trim()
    .replace(/^(?:#{1,6}\s*|>\s*)+/, "")
    .replace(/^(?:\*\*|__)/, "")
    .replace(/(?:\*\*|__)$/, "")
    .trim();
}

function parseKnownHeadingLine(line: string): { heading: CompactionSummaryHeading; inlineContent: string } | null {
  const stripped = stripHeadingDecorators(line);

  for (const heading of COMPACTION_SUMMARY_HEADINGS) {
    const matcher = new RegExp(
      `^${escapeRegExp(heading)}(?:\\s*:\\s*(.*)|\\s+(.+))?$`,
      "i"
    );
    const match = stripped.match(matcher);
    if (!match) {
      continue;
    }

    return {
      heading,
      inlineContent: (match[1] ?? match[2] ?? "").trim()
    };
  }

  return null;
}

function looksLikeHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(?:#{1,6}\s*|>\s*|\*\*|__)/.test(trimmed)) {
    return true;
  }

  return /^[A-Z][A-Za-z0-9 &/_-]{0,60}:\s*(.*)?$/.test(trimmed);
}

function parseSummaryLines(content: string): CompactionSummarySections {
  const sections = createEmptySections();
  let activeHeading: CompactionSummaryHeading | null = null;

  const trimmedContent = content.trim();
  if (trimmedContent.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmedContent) as Record<string, unknown>;
      const unresolvedItems = Array.isArray(parsed.unresolvedItems)
        ? parsed.unresolvedItems.filter((item): item is string => typeof item === "string")
        : [];
      const importantReferences = Array.isArray(parsed.importantReferences)
        ? parsed.importantReferences.filter((item): item is string => typeof item === "string")
        : [];

      if (unresolvedItems.length) {
        sections["Open Tasks"].push(...unresolvedItems.map(normalizeSummaryItem).filter(Boolean));
      }
      if (importantReferences.length) {
        sections["Artifact References"].push(
          ...importantReferences.map(normalizeSummaryItem).filter(Boolean)
        );
      }

      if (sections["Open Tasks"].length || sections["Artifact References"].length) {
        return sections;
      }
    } catch {
      // Fall back to the line-based parser for malformed legacy JSON.
    }
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headingMatch = parseKnownHeadingLine(line);
    if (headingMatch) {
      activeHeading = headingMatch.heading;
      const inlineContent = normalizeSummaryItem(headingMatch.inlineContent);
      if (inlineContent && !isPlaceholderSummaryItem(inlineContent)) {
        sections[activeHeading].push(inlineContent);
      }
      continue;
    }

    if (looksLikeHeadingLine(line)) {
      activeHeading = null;
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

function containsBoundarySafe(haystack: string, needle: string): boolean {
  if (!needle.trim()) {
    return false;
  }

  const escaped = escapeRegExp(needle.trim());
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, "i");
  return pattern.test(haystack);
}

function artifactCandidates(reference: string): string[] {
  const normalizedReference = normalizeArtifactReference(reference).replace(/\s+/g, " ");
  const candidates = new Set<string>();

  if (normalizedReference) {
    candidates.add(normalizedReference);
  }

  const pathSegments = normalizedReference.split(/[\\/]/).filter(Boolean);
  const basename = pathSegments.at(-1);
  if (basename) {
    candidates.add(basename);
  }

  const tail = pathSegments.slice(-2).join("/");
  if (tail) {
    candidates.add(tail);
  }

  if (/^https?:\/\//i.test(reference)) {
    try {
      const url = new URL(reference);
      const hostAndPath = normalizeArtifactReference(`${url.host}${url.pathname}`).replace(/\s+/g, " ");
      if (hostAndPath) {
        candidates.add(hostAndPath);
      }

      const pathTail = url.pathname.split("/").filter(Boolean).at(-1);
      if (pathTail) {
        candidates.add(pathTail.toLowerCase());
      }
    } catch {
      // Ignore malformed URLs and fall back to the normalized path candidates.
    }
  }

  return [...candidates];
}

export function artifactReferenceMatchesUserMessage(userMessage: string, reference: string): boolean {
  const normalizedUser = normalizeArtifactReference(userMessage).replace(/\s+/g, " ");
  const candidates = artifactCandidates(reference);

  if (!candidates.length) {
    return false;
  }

  for (const candidate of candidates) {
    if (containsBoundarySafe(normalizedUser, candidate)) {
      return true;
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

export type ReferenceTrigger = "@" | "/";

export type ReferenceCandidate = { trigger: ReferenceTrigger; name: string };

export type ReferenceToken = ReferenceCandidate & { start: number; end: number };

export type ReferenceBot = { name: string; title: string; avatarSeed: string };

export type ReferenceSkill = { name: string; description: string };

export type ComposerReferences = { bots: ReferenceBot[]; skills: ReferenceSkill[] };

export type ActiveReferenceQuery = { trigger: ReferenceTrigger; query: string; start: number };

export const REFERENCE_TAG = "reference";

const MAX_QUERY_CHARS = 80;
const TOKEN_START_PRECEDERS = /[\s([{"'“‘]/;
const TOKEN_END_FOLLOWERS = /[\s.,!?;:)\]}"'”’]/;
const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g;

function maskCode(text: string) {
  return text.replace(CODE_PATTERN, (code) => " ".repeat(code.length));
}

function isReferenceTrigger(char: string | undefined): char is ReferenceTrigger {
  return char === "@" || char === "/";
}

function canStartToken(text: string, index: number) {
  return index === 0 || TOKEN_START_PRECEDERS.test(text[index - 1]);
}

function endsToken(char: string | undefined) {
  return char === undefined || TOKEN_END_FOLLOWERS.test(char);
}

export function toReferenceCandidates(references: ComposerReferences): ReferenceCandidate[] {
  return [
    ...references.bots.map((bot) => ({ trigger: "@" as const, name: bot.name })),
    ...references.skills.map((skill) => ({ trigger: "/" as const, name: skill.name }))
  ];
}

export function findReferenceTokens(text: string, candidates: ReferenceCandidate[]): ReferenceToken[] {
  const usable = candidates
    .filter((candidate) => candidate.name.trim())
    .sort((left, right) => right.name.length - left.name.length);
  if (!usable.length) return [];

  const tokens: ReferenceToken[] = [];
  const searchable = maskCode(text);

  for (let index = 0; index < searchable.length; index += 1) {
    const trigger = searchable[index];
    if (!isReferenceTrigger(trigger) || !canStartToken(searchable, index)) continue;

    const match = usable.find(
      (candidate) =>
        candidate.trigger === trigger &&
        searchable.slice(index + 1, index + 1 + candidate.name.length).toLowerCase() === candidate.name.toLowerCase() &&
        endsToken(searchable[index + 1 + candidate.name.length])
    );
    if (!match) continue;

    const end = index + 1 + match.name.length;
    tokens.push({ trigger, name: match.name, start: index, end });
    index = end - 1;
  }

  return tokens;
}

export function findReferencedNames(
  text: string,
  trigger: ReferenceTrigger,
  names: string[]
): string[] {
  const found = findReferenceTokens(
    text,
    names.map((name) => ({ trigger, name }))
  ).map((token) => token.name);
  return [...new Set(found)];
}

export function findActiveReferenceQuery(
  text: string,
  caret: number,
  triggers: ReferenceTrigger[]
): ActiveReferenceQuery | null {
  if (!triggers.length) return null;

  for (let index = caret - 1; index >= 0 && caret - index <= MAX_QUERY_CHARS + 1; index -= 1) {
    const char = text[index];
    if (char === "\n") return null;
    if (!isReferenceTrigger(char) || !triggers.includes(char) || !canStartToken(text, index)) continue;

    const query = text.slice(index + 1, caret);
    if (/^\s/.test(query)) return null;
    return { trigger: char, query, start: index };
  }

  return null;
}

export function filterReferenceOptions<T extends { name: string; detail?: string }>(
  options: T[],
  query: string
): T[] {
  const needle = query.toLowerCase();
  if (!needle) return options;

  const hasWhitespace = /\s/.test(needle);
  if (hasWhitespace && options.some((option) => option.name.toLowerCase() === needle.trimEnd())) {
    return [];
  }

  const ranked = options
    .map((option) => {
      const name = option.name.toLowerCase();
      if (name.startsWith(needle)) return { option, rank: 0 };
      if (name.includes(needle)) return { option, rank: 1 };
      if (!hasWhitespace && option.detail?.toLowerCase().includes(needle)) return { option, rank: 2 };
      return null;
    })
    .filter((entry): entry is { option: T; rank: number } => entry !== null);

  return ranked.sort((left, right) => left.rank - right.rank).map((entry) => entry.option);
}

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
};

function splitReferenceTokens(node: MarkdownNode, candidates: ReferenceCandidate[]) {
  if (!node.children || node.type === "link" || node.type === "linkReference") return;

  node.children = node.children.flatMap((child) => {
    if (child.type !== "text" || !child.value) {
      splitReferenceTokens(child, candidates);
      return [child];
    }

    const tokens = findReferenceTokens(child.value, candidates);
    if (!tokens.length) return [child];

    const parts: MarkdownNode[] = [];
    let cursor = 0;
    for (const token of tokens) {
      if (token.start > cursor) parts.push({ type: "text", value: child.value.slice(cursor, token.start) });
      parts.push({
        type: "referenceToken",
        data: {
          hName: REFERENCE_TAG,
          hProperties: { kind: token.trigger === "@" ? "bot" : "skill" }
        },
        children: [{ type: "text", value: child.value.slice(token.start, token.end) }]
      });
      cursor = token.end;
    }
    if (cursor < child.value.length) parts.push({ type: "text", value: child.value.slice(cursor) });
    return parts;
  });
}

export function remarkReferenceTokens(candidates: ReferenceCandidate[]) {
  return (tree: MarkdownNode) => {
    splitReferenceTokens(tree, candidates);
  };
}

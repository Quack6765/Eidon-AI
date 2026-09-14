import type { MessageAction, MessageActionKind, MessageActionStatus } from "@/lib/types";

export type ToolActivityRow = {
  id: string;
  label: string;
  meta: string;
  status: MessageActionStatus;
};

export type ToolActivitySummary = {
  rows: ToolActivityRow[];
  text: string;
  total: number;
};

export type ToolActivitySource = Pick<
  MessageAction,
  "id" | "kind" | "toolName" | "label" | "detail" | "status" | "arguments"
>;

const PROPOSAL_ACTION_KINDS: ReadonlySet<MessageActionKind> = new Set([
  "create_memory",
  "update_memory",
  "delete_memory",
  "create_automation"
]);

const BUCKETS = [
  { key: "tools", singular: "tool", plural: "tools" },
  { key: "webSearches", singular: "web search", plural: "web searches" },
  { key: "pagesRead", singular: "page read", plural: "pages read" }
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

export function isMessageBotActionKind(kind: MessageActionKind) {
  return kind === "delegate_task" || kind === "message_bot";
}

export function isToolActivityAction(action: Pick<MessageAction, "kind">) {
  return !PROPOSAL_ACTION_KINDS.has(action.kind) && !isMessageBotActionKind(action.kind);
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getWebSearchQuery(argumentValues: Record<string, unknown> | null) {
  const query = argumentValues?.query;

  if (typeof query === "string" && query.trim()) {
    return collapseWhitespace(query);
  }

  const queries = argumentValues?.queries;

  if (Array.isArray(queries)) {
    return queries
      .filter((entry): entry is string => typeof entry === "string")
      .map(collapseWhitespace)
      .filter(Boolean)
      .join("; ");
  }

  return "";
}

function getActionMeta(action: ToolActivitySource) {
  if (action.toolName === "web_search") {
    const query = getWebSearchQuery(action.arguments);

    if (query) {
      return query;
    }
  }

  return collapseWhitespace(action.detail);
}

function getBucketKey(action: ToolActivitySource): BucketKey {
  if (action.toolName === "web_search") {
    return "webSearches";
  }

  if (action.toolName === "read_page") {
    return "pagesRead";
  }

  return "tools";
}

export function summarizeToolActivity(actions: ToolActivitySource[]): ToolActivitySummary {
  const counts = new Map<BucketKey, number>();
  const rows: ToolActivityRow[] = [];

  for (const action of actions) {
    if (!isToolActivityAction(action)) {
      continue;
    }

    const bucket = getBucketKey(action);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    rows.push({
      id: action.id,
      label: collapseWhitespace(action.label),
      meta: getActionMeta(action),
      status: action.status
    });
  }

  const text = BUCKETS.flatMap((bucket) => {
    const count = counts.get(bucket.key) ?? 0;

    return count > 0 ? [`${count} ${count === 1 ? bucket.singular : bucket.plural}`] : [];
  }).join(", ");

  return { rows, text, total: rows.length };
}

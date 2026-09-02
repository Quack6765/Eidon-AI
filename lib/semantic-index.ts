import { createHash } from "node:crypto";

import { renderMemoryNode } from "@/lib/compaction-memory-nodes";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import {
  awaitEmbeddingModel,
  disposeEmbeddingModel,
  embedTexts,
  getEmbeddingModelId,
  initEmbeddingModel,
  isEmbeddingDisabled,
  isEmbeddingModelReady
} from "@/lib/local-embedding-model";
import { nowIso } from "@/lib/utils";

export type SemanticChunkKind = "memory" | "message" | "memory_node" | "attachment";

export const SEMANTIC_CHUNK_KINDS: SemanticChunkKind[] = ["memory", "message", "memory_node", "attachment"];
export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 50;
export const MAX_SOURCE_CHARS = 20_000;
const BACKFILL_BATCH_SIZE = 32;

export type ScoredChunk = {
  id: string;
  kind: SemanticChunkKind;
  refId: string;
  conversationId: string | null;
  chunkText: string;
  sourceCreatedAt: string;
  score: number;
};

type Source = {
  refId: string;
  text: string;
  userId: string | null;
  conversationId: string | null;
  createdAt: string;
};

type SourceRow = {
  id: string;
  content: string | null;
  user_id: string | null;
  conversation_id: string | null;
  created_at: string;
};

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= size) return [normalized];

  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + size);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(" ", end);
      if (boundary > start + size / 2) end = boundary;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

function refColumn(kind: SemanticChunkKind) {
  switch (kind) {
    case "memory":
      return "memory_id";
    case "message":
      return "message_id";
    case "memory_node":
      return "memory_node_id";
    case "attachment":
      return "attachment_id";
  }
}

function sourceSql(kind: SemanticChunkKind, whereClause: string) {
  switch (kind) {
    case "memory":
      return `SELECT um.id, um.content, um.user_id, NULL AS conversation_id, um.created_at
              FROM user_memories um
              WHERE ${whereClause}`;
    case "message":
      return `SELECT m.id, m.content, c.user_id, c.id AS conversation_id, m.created_at
              FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
              WHERE m.role IN ('user', 'assistant') AND m.status = 'completed' AND c.is_temporary = 0 AND ${whereClause}`;
    case "memory_node":
      return `SELECT n.id, n.content, c.user_id, c.id AS conversation_id, n.created_at
              FROM memory_nodes n
              JOIN conversations c ON c.id = n.conversation_id
              WHERE n.superseded_by_node_id IS NULL AND c.is_temporary = 0 AND ${whereClause}`;
    case "attachment":
      return `SELECT a.id, a.extracted_text AS content, c.user_id, c.id AS conversation_id, a.created_at
              FROM message_attachments a
              JOIN conversations c ON c.id = a.conversation_id
              WHERE a.kind = 'text' AND c.is_temporary = 0 AND ${whereClause}`;
  }
}

function sourceAlias(kind: SemanticChunkKind) {
  switch (kind) {
    case "memory":
      return "um";
    case "message":
      return "m";
    case "memory_node":
      return "n";
    case "attachment":
      return "a";
  }
}

function rowToSource(kind: SemanticChunkKind, row: SourceRow): Source {
  const raw = row.content ?? "";
  const text = kind === "memory_node" ? renderMemoryNode(raw) : raw;
  return {
    refId: row.id,
    text: text.slice(0, MAX_SOURCE_CHARS),
    userId: row.user_id,
    conversationId: row.conversation_id,
    createdAt: row.created_at
  };
}

function loadSources(kind: SemanticChunkKind, refIds: string[]): Map<string, Source> {
  const sources = new Map<string, Source>();
  if (!refIds.length) return sources;
  const alias = sourceAlias(kind);
  const placeholders = refIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(sourceSql(kind, `${alias}.id IN (${placeholders})`))
    .all(...refIds) as SourceRow[];
  for (const row of rows) {
    sources.set(row.id, rowToSource(kind, row));
  }
  return sources;
}

function listSourceIds(kind: SemanticChunkKind, cursor: string, limit: number, conversationId?: string): string[] {
  const alias = sourceAlias(kind);
  const conversationClause = conversationId && kind !== "memory" ? ` AND c.id = ?` : "";
  const rows = getDb()
    .prepare(
      `SELECT ${alias}.id FROM (${sourceSql(kind, `${alias}.id > ?${conversationClause}`)}) ${alias}
       LEFT JOIN semantic_chunks sc ON sc.kind = ? AND sc.ref_id = ${alias}.id AND sc.chunk_index = 0
       WHERE ${kind === "memory" ? "1 = 1" : "sc.id IS NULL"}
       ORDER BY ${alias}.id
       LIMIT ?`
    )
    .all(cursor, ...(conversationClause ? [conversationId] : []), kind, limit) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function deleteSemanticChunks(kind: SemanticChunkKind, refIds: string[]) {
  if (!refIds.length) return;
  const statement = getDb().prepare("DELETE FROM semantic_chunks WHERE kind = ? AND ref_id = ?");
  const transaction = getDb().transaction((ids: string[]) => {
    for (const id of ids) statement.run(kind, id);
  });
  transaction(refIds);
}

function vectorToBlob(vector: Float32Array) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function blobToVector(blob: Buffer) {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}

async function indexBatch(kind: SemanticChunkKind, refIds: string[]) {
  if (!refIds.length) return;
  if (!(await awaitEmbeddingModel())) return;

  const modelId = getEmbeddingModelId();
  const sources = loadSources(kind, refIds);
  const existingStatement = getDb().prepare(
    "SELECT content_hash, model_id FROM semantic_chunks WHERE kind = ? AND ref_id = ? AND chunk_index = 0"
  );

  const pending: Array<{ source: Source; hash: string; chunks: string[] }> = [];
  const stale: string[] = [];

  for (const refId of refIds) {
    const source = sources.get(refId);
    const text = source?.text.trim() ?? "";
    if (!source || !source.userId || !text) {
      stale.push(refId);
      continue;
    }
    const hash = hashContent(text);
    const existing = existingStatement.get(kind, refId) as { content_hash: string; model_id: string } | undefined;
    if (existing && existing.content_hash === hash && existing.model_id === modelId) continue;
    const chunks = chunkText(text);
    if (!chunks.length) {
      stale.push(refId);
      continue;
    }
    pending.push({ source, hash, chunks });
  }

  deleteSemanticChunks(kind, stale);
  if (!pending.length) return;

  const flatChunks = pending.flatMap((entry) => entry.chunks);
  const vectors = await embedTexts(flatChunks);
  if (!vectors || vectors.length !== flatChunks.length) return;

  const insert = getDb().prepare(
    `INSERT INTO semantic_chunks (
      id, kind, ref_id, chunk_index, user_id, conversation_id, ${refColumn(kind)},
      chunk_text, content_hash, model_id, dim, embedding, source_created_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const remove = getDb().prepare("DELETE FROM semantic_chunks WHERE kind = ? AND ref_id = ?");
  const timestamp = nowIso();

  const transaction = getDb().transaction(() => {
    let offset = 0;
    for (const entry of pending) {
      remove.run(kind, entry.source.refId);
      entry.chunks.forEach((chunk, chunkIndex) => {
        const vector = vectors[offset + chunkIndex];
        insert.run(
          createId("chk"),
          kind,
          entry.source.refId,
          chunkIndex,
          entry.source.userId,
          entry.source.conversationId,
          entry.source.refId,
          chunk,
          entry.hash,
          modelId,
          vector.length,
          vectorToBlob(vector),
          entry.source.createdAt,
          timestamp
        );
      });
      offset += entry.chunks.length;
    }
  });
  transaction();
}

function logIndexError(error: unknown) {
  console.error("[semantic-index] Indexing failed:", error instanceof Error ? error.message : error);
}

export function queueSemanticIndex(kind: SemanticChunkKind, refId: string) {
  if (isEmbeddingDisabled()) return;
  void indexBatch(kind, [refId]).catch(logIndexError);
}

export async function indexConversationMessages(conversationId: string) {
  if (isEmbeddingDisabled()) return;
  let cursor = "";
  while (true) {
    const ids = listSourceIds("message", cursor, BACKFILL_BATCH_SIZE, conversationId);
    if (!ids.length) return;
    await indexBatch("message", ids);
    cursor = ids[ids.length - 1];
  }
}

export function queueConversationIndex(conversationId: string) {
  if (isEmbeddingDisabled()) return;
  void indexConversationMessages(conversationId).catch(logIndexError);
}

let backfillPromise: Promise<void> | null = null;

async function backfill() {
  if (!(await awaitEmbeddingModel())) return;
  getDb().prepare("DELETE FROM semantic_chunks WHERE model_id != ?").run(getEmbeddingModelId());

  for (const kind of SEMANTIC_CHUNK_KINDS) {
    let cursor = "";
    while (isEmbeddingModelReady()) {
      const ids = listSourceIds(kind, cursor, BACKFILL_BATCH_SIZE);
      if (!ids.length) break;
      await indexBatch(kind, ids);
      cursor = ids[ids.length - 1];
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

export function runSemanticBackfill(): Promise<void> {
  if (backfillPromise) return backfillPromise;
  backfillPromise = backfill()
    .catch(logIndexError)
    .finally(() => {
      backfillPromise = null;
    });
  return backfillPromise;
}

export function isSemanticBackfillRunning() {
  return backfillPromise !== null;
}

export async function startSemanticIndex() {
  if (await initEmbeddingModel()) {
    await runSemanticBackfill();
  }
}

export function stopSemanticIndex() {
  disposeEmbeddingModel();
}

export async function rebuildSemanticIndex() {
  getDb().prepare("DELETE FROM semantic_chunks").run();
  await startSemanticIndex();
}

export function getSemanticIndexStatus() {
  const chunkCount = (getDb().prepare("SELECT COUNT(*) AS count FROM semantic_chunks").get() as { count: number }).count;
  let pendingCount = 0;
  for (const kind of SEMANTIC_CHUNK_KINDS) {
    if (kind === "memory") continue;
    const alias = sourceAlias(kind);
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS count FROM (${sourceSql(kind, "1 = 1")}) ${alias}
         LEFT JOIN semantic_chunks sc ON sc.kind = ? AND sc.ref_id = ${alias}.id AND sc.chunk_index = 0
         WHERE sc.id IS NULL`
      )
      .get(kind) as { count: number };
    pendingCount += row.count;
  }
  return {
    available: !isEmbeddingDisabled(),
    ready: isEmbeddingModelReady(),
    modelId: getEmbeddingModelId(),
    chunkCount,
    pendingCount,
    backfillRunning: isSemanticBackfillRunning()
  };
}

export function isSemanticRecallAvailable() {
  return !isEmbeddingDisabled() && isEmbeddingModelReady();
}

export async function embedQuery(text: string): Promise<Float32Array | null> {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || !isSemanticRecallAvailable()) return null;
  const vectors = await embedTexts([normalized.slice(0, CHUNK_SIZE * 2)]);
  return vectors?.[0] ?? null;
}

export const MIN_SEARCH_SCORE = 0.3;

export type WorkspaceSearchResult = {
  kind: SemanticChunkKind;
  title: string;
  snippet: string;
  conversationId: string | null;
  memoryId: string | null;
  score: number;
  date: string;
};

function lookupTitles(table: string, column: string, ids: string[]) {
  const titles = new Map<string, string>();
  if (!ids.length) return titles;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(`SELECT id, ${column} AS title FROM ${table} WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: string; title: string }>;
  for (const row of rows) titles.set(row.id, row.title);
  return titles;
}

export async function searchWorkspace(input: {
  userId: string;
  query: string;
  limit: number;
  memoryBotId?: string | null;
}): Promise<WorkspaceSearchResult[] | null> {
  const queryVector = await embedQuery(input.query);
  if (!queryVector) return null;

  const scored = scoreChunks({
    userId: input.userId,
    kinds: SEMANTIC_CHUNK_KINDS,
    queryVector,
    limit: input.limit * 4,
    memoryBotId: input.memoryBotId
  });

  const best = new Map<string, ScoredChunk>();
  for (const chunk of scored) {
    if (chunk.score < MIN_SEARCH_SCORE) continue;
    const key = `${chunk.kind}:${chunk.refId}`;
    if (!best.has(key)) best.set(key, chunk);
  }
  const hits = [...best.values()].slice(0, input.limit);

  const conversationTitles = lookupTitles(
    "conversations",
    "title",
    [...new Set(hits.map((hit) => hit.conversationId).filter((id): id is string => Boolean(id)))]
  );
  const memoryCategories = lookupTitles(
    "user_memories",
    "category",
    hits.filter((hit) => hit.kind === "memory").map((hit) => hit.refId)
  );
  const attachmentNames = lookupTitles(
    "message_attachments",
    "filename",
    hits.filter((hit) => hit.kind === "attachment").map((hit) => hit.refId)
  );

  return hits.map((hit) => {
    const conversationTitle = hit.conversationId ? conversationTitles.get(hit.conversationId) ?? "Untitled" : "";
    const title =
      hit.kind === "memory"
        ? `Memory (${memoryCategories.get(hit.refId) ?? "other"})`
        : hit.kind === "attachment"
          ? `${attachmentNames.get(hit.refId) ?? "Attachment"} in ${conversationTitle}`
          : hit.kind === "memory_node"
            ? `Summary of ${conversationTitle}`
            : conversationTitle;
    return {
      kind: hit.kind,
      title,
      snippet: hit.chunkText.length > 300 ? `${hit.chunkText.slice(0, 297)}...` : hit.chunkText,
      conversationId: hit.conversationId,
      memoryId: hit.kind === "memory" ? hit.refId : null,
      score: Math.round(hit.score * 1000) / 1000,
      date: hit.sourceCreatedAt
    };
  });
}

export function scoreChunks(input: {
  userId: string;
  kinds: SemanticChunkKind[];
  queryVector: Float32Array;
  limit: number;
  memoryBotId?: string | null;
}): ScoredChunk[] {
  if (!input.kinds.length || input.limit <= 0) return [];
  const placeholders = input.kinds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT sc.id, sc.kind, sc.ref_id, sc.conversation_id, sc.chunk_text, sc.embedding, sc.source_created_at
       FROM semantic_chunks sc
       LEFT JOIN user_memories um ON um.id = sc.memory_id
       WHERE sc.user_id = ? AND sc.model_id = ? AND sc.dim = ? AND sc.kind IN (${placeholders})
         AND (sc.kind != 'memory' OR um.bot_id IS NULL OR um.bot_id = ?)`
    )
    .all(
      input.userId,
      getEmbeddingModelId(),
      input.queryVector.length,
      ...input.kinds,
      input.memoryBotId ?? null
    ) as Array<{
      id: string;
      kind: SemanticChunkKind;
      ref_id: string;
      conversation_id: string | null;
      chunk_text: string;
      embedding: Buffer;
      source_created_at: string;
    }>;

  const query = input.queryVector;
  const scored: ScoredChunk[] = rows.map((row) => {
    const vector = blobToVector(row.embedding);
    let score = 0;
    for (let index = 0; index < query.length; index += 1) {
      score += query[index] * vector[index];
    }
    return {
      id: row.id,
      kind: row.kind,
      refId: row.ref_id,
      conversationId: row.conversation_id,
      chunkText: row.chunk_text,
      sourceCreatedAt: row.source_created_at,
      score
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, input.limit);
}

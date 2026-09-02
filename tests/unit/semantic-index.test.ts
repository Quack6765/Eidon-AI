import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFakeEmbeddingModule,
  fakeEmbed,
  fakeEmbeddingState,
  resetFakeEmbeddingState
} from "./fake-embedding-model";

vi.mock("@/lib/local-embedding-model", () => createFakeEmbeddingModule());

import { insertMemoryNode, supersedeNodes } from "@/lib/compaction-memory-nodes";
import {
  createConversation,
  createMessage,
  deleteConversation,
  searchConversations,
  searchConversationsWithRecall
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createMemory, deleteMemory, updateMemory } from "@/lib/memories";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  chunkText,
  getSemanticIndexStatus,
  indexConversationMessages,
  queueSemanticIndex,
  rebuildSemanticIndex,
  runSemanticBackfill,
  scoreChunks,
  searchWorkspace,
  startSemanticIndex,
  stopSemanticIndex
} from "@/lib/semantic-index";
import { createLocalUser } from "@/lib/users";

type ChunkRow = { kind: string; ref_id: string; model_id: string; created_at: string; chunk_index: number };

function chunkRows(where = "1 = 1", ...params: unknown[]) {
  return getDb()
    .prepare(`SELECT kind, ref_id, model_id, created_at, chunk_index FROM semantic_chunks WHERE ${where} ORDER BY ref_id, chunk_index`)
    .all(...params) as ChunkRow[];
}

async function createUser(username: string) {
  return createLocalUser({ username, password: "Password123!", role: "user" });
}

function insertAttachment(conversationId: string, filename: string, extractedText: string) {
  const id = `att_${filename}`;
  getDb()
    .prepare(
      `INSERT INTO message_attachments (
        id, conversation_id, message_id, filename, mime_type, byte_size, sha256, relative_path, kind, extracted_text, created_at
      ) VALUES (?, ?, NULL, ?, 'text/plain', 10, 'hash', ?, 'text', ?, ?)`
    )
    .run(id, conversationId, filename, `${conversationId}/${filename}`, extractedText, new Date().toISOString());
  return id;
}

describe("chunkText", () => {
  it("returns nothing for empty or whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t ")).toEqual([]);
  });

  it("returns a single normalized chunk for short text", () => {
    expect(chunkText("  hello\n\n  world ")).toEqual(["hello world"]);
  });

  it("splits long text into overlapping chunks on word boundaries", () => {
    const words = Array.from({ length: 400 }, (_, index) => `word${index}`);
    const text = words.join(" ");
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
      expect(chunk.startsWith(" ")).toBe(false);
      expect(chunk.endsWith(" ")).toBe(false);
    }
    const lastWordOfFirst = chunks[0].split(" ").at(-1) ?? "";
    expect(chunks[1]).toContain(lastWordOfFirst);
    expect(chunks.join(" ")).toContain("word399");
    expect(CHUNK_OVERLAP).toBeLessThan(CHUNK_SIZE);
  });

  it("splits text without spaces by size", () => {
    const chunks = chunkText("x".repeat(1200), 500, 50);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toHaveLength(500);
  });
});

describe("semantic index", () => {
  beforeEach(() => {
    resetFakeEmbeddingState();
  });

  it("indexes memories on create, re-embeds on content change, and cascades on delete", async () => {
    const user = await createUser("index-memory");
    const memory = createMemory("I live in montreal", "location", user.id);

    await vi.waitFor(() => expect(chunkRows("ref_id = ?", memory.id)).toHaveLength(1));
    const first = chunkRows("ref_id = ?", memory.id)[0];
    expect(first.kind).toBe("memory");
    expect(first.model_id).toBe("fake-model-v1");

    updateMemory(memory.id, { category: "personal" }, user.id);
    await runSemanticBackfill();
    expect(chunkRows("ref_id = ?", memory.id)[0].created_at).toBe(first.created_at);

    const callsBefore = fakeEmbeddingState.embedCalls;
    updateMemory(memory.id, { content: "I moved to paris" }, user.id);
    await vi.waitFor(() => expect(fakeEmbeddingState.embedCalls).toBeGreaterThan(callsBefore));
    await vi.waitFor(() => {
      const hits = scoreChunks({ userId: user.id, kinds: ["memory"], queryVector: fakeEmbed("paris"), limit: 5 });
      expect(hits[0]?.refId).toBe(memory.id);
      expect(hits[0]?.chunkText).toContain("paris");
    });

    deleteMemory(memory.id, user.id);
    expect(chunkRows("ref_id = ?", memory.id)).toHaveLength(0);
  });

  it("indexes conversation messages after a turn and purges them when the conversation is deleted", async () => {
    const user = await createUser("index-conversation");
    const conversation = createConversation("Budget chat", null, undefined, user.id);
    createMessage({ conversationId: conversation.id, role: "user", content: "Plan the budget for paris" });
    createMessage({ conversationId: conversation.id, role: "assistant", content: "The budget covers coffee" });
    createMessage({ conversationId: conversation.id, role: "system", content: "hidden instructions" });
    createMessage({ conversationId: conversation.id, role: "assistant", content: "draft", status: "streaming" });

    await indexConversationMessages(conversation.id);
    const rows = chunkRows("conversation_id = ?", conversation.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "message")).toBe(true);

    await indexConversationMessages(conversation.id);
    expect(chunkRows("conversation_id = ?", conversation.id)).toHaveLength(2);

    deleteConversation(conversation.id, user.id);
    expect(chunkRows("conversation_id = ?", conversation.id)).toHaveLength(0);
  });

  it("skips temporary conversations and content without an owner", async () => {
    const user = await createUser("index-temporary");
    const temporary = createConversation("Temp", null, { isTemporary: true }, user.id);
    createMessage({ conversationId: temporary.id, role: "user", content: "montreal secrets" });
    const orphan = createConversation("No owner");
    createMessage({ conversationId: orphan.id, role: "user", content: "montreal secrets" });
    createMemory("unowned montreal memory", "other");

    await runSemanticBackfill();
    expect(chunkRows()).toHaveLength(0);
  });

  it("indexes memory nodes and drops them when superseded", async () => {
    const user = await createUser("index-nodes");
    const conversation = createConversation("Summaries", null, undefined, user.id);
    const message = createMessage({ conversationId: conversation.id, role: "user", content: "hello" });
    const node = insertMemoryNode({
      conversationId: conversation.id,
      type: "leaf_summary",
      depth: 0,
      content: JSON.stringify({ factualCommitments: ["chose kubernetes for the deploy"] }),
      sourceStartMessageId: message.id,
      sourceEndMessageId: message.id,
      sourceTokenCount: 10,
      summaryTokenCount: 5
    });

    await vi.waitFor(() => expect(chunkRows("ref_id = ?", node.id)).toHaveLength(1));
    const hits = scoreChunks({ userId: user.id, kinds: ["memory_node"], queryVector: fakeEmbed("kubernetes"), limit: 5 });
    expect(hits[0]?.chunkText).toBe("Facts: chose kubernetes for the deploy");

    supersedeNodes([node.id], "mem_parent");
    expect(chunkRows("ref_id = ?", node.id)).toHaveLength(0);
    await runSemanticBackfill();
    expect(chunkRows("ref_id = ?", node.id)).toHaveLength(0);
  });

  it("indexes attachment text with a bounded number of chunks", async () => {
    const user = await createUser("index-attachments");
    const conversation = createConversation("Docs", null, undefined, user.id);
    const attachmentId = insertAttachment(conversation.id, "notes.txt", "violin ".repeat(20_000));

    queueSemanticIndex("attachment", attachmentId);
    await vi.waitFor(() => expect(chunkRows("ref_id = ?", attachmentId).length).toBeGreaterThan(1));
    expect(chunkRows("ref_id = ?", attachmentId).length).toBeLessThanOrEqual(50);
    const hits = scoreChunks({ userId: user.id, kinds: ["attachment"], queryVector: fakeEmbed("violin"), limit: 1 });
    expect(hits[0]?.refId).toBe(attachmentId);
  });

  it("backfills idempotently and purges rows from a previous model", async () => {
    const user = await createUser("index-backfill");
    fakeEmbeddingState.ready = false;
    const memory = createMemory("chess openings", "other", user.id);
    const conversation = createConversation("Sailing", null, undefined, user.id);
    createMessage({ conversationId: conversation.id, role: "user", content: "sailing plans" });
    expect(chunkRows()).toHaveLength(0);

    fakeEmbeddingState.ready = true;
    await runSemanticBackfill();
    const afterFirst = chunkRows();
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst.map((row) => row.ref_id)).toContain(memory.id);

    await runSemanticBackfill();
    expect(chunkRows()).toEqual(afterFirst);

    fakeEmbeddingState.modelId = "fake-model-v2";
    await runSemanticBackfill();
    const afterSwap = chunkRows();
    expect(afterSwap).toHaveLength(2);
    expect(afterSwap.every((row) => row.model_id === "fake-model-v2")).toBe(true);
    expect(getSemanticIndexStatus()).toMatchObject({
      modelId: "fake-model-v2",
      chunkCount: 2,
      pendingCount: 0,
      backfillRunning: false,
      ready: true,
      available: true
    });
  });

  it("does nothing while disabled and rebuilds from scratch on demand", async () => {
    const user = await createUser("index-disabled");
    fakeEmbeddingState.disabled = true;
    createMemory("garden layout", "other", user.id);
    queueSemanticIndex("memory", "missing");
    await runSemanticBackfill();
    expect(chunkRows()).toHaveLength(0);
    expect(getSemanticIndexStatus()).toMatchObject({ available: false, ready: false, chunkCount: 0 });

    fakeEmbeddingState.disabled = false;
    await startSemanticIndex();
    expect(chunkRows()).toHaveLength(1);

    getDb().prepare("UPDATE semantic_chunks SET model_id = 'stale'").run();
    await rebuildSemanticIndex();
    expect(chunkRows()).toHaveLength(1);
    expect(chunkRows()[0].model_id).toBe("fake-model-v1");

    stopSemanticIndex();
    expect(fakeEmbeddingState.ready).toBe(false);
  });

  it("scores only the requesting user's chunks and respects bot memory scope", async () => {
    const userA = await createUser("score-a");
    const userB = await createUser("score-b");
    const botId = "bot_1";
    const home = createConversation("Bot home", null, undefined, userA.id);
    getDb()
      .prepare(
        `INSERT INTO bots (id, user_id, name, avatar_seed, system_prompt, home_conversation_id, created_at, updated_at)
         VALUES (?, ?, 'Bot', 'seed', '', ?, ?, ?)`
      )
      .run(botId, userA.id, home.id, new Date().toISOString(), new Date().toISOString());

    createMemory("marathon training in montreal", "other", userA.id);
    createMemory("marathon nutrition", "other", userA.id, { botId });
    createMemory("marathon shoes", "other", userB.id);
    await runSemanticBackfill();

    const query = fakeEmbed("marathon");
    const mainOnly = scoreChunks({ userId: userA.id, kinds: ["memory"], queryVector: query, limit: 10 });
    expect(mainOnly.map((hit) => hit.chunkText)).toEqual(["marathon training in montreal"]);

    const withBot = scoreChunks({ userId: userA.id, kinds: ["memory"], queryVector: query, limit: 10, memoryBotId: botId });
    expect(withBot.map((hit) => hit.chunkText).sort()).toEqual(["marathon nutrition", "marathon training in montreal"]);

    const other = scoreChunks({ userId: userB.id, kinds: ["memory"], queryVector: query, limit: 10 });
    expect(other.map((hit) => hit.chunkText)).toEqual(["marathon shoes"]);
    expect(scoreChunks({ userId: userA.id, kinds: [], queryVector: query, limit: 10 })).toEqual([]);
  });

  it("searches the workspace across kinds with titles and never leaks across users", async () => {
    const userA = await createUser("workspace-a");
    const userB = await createUser("workspace-b");
    const memory = createMemory("We picked typescript for the backend", "work", userA.id);
    const chat = createConversation("Architecture decision", null, undefined, userA.id);
    createMessage({ conversationId: chat.id, role: "assistant", content: "Decision: deploy on kubernetes" });
    const automation = createConversation("Nightly report", null, { origin: "automation" }, userA.id);
    createMessage({ conversationId: automation.id, role: "assistant", content: "kubernetes cluster healthy" });
    const docs = createConversation("Docs", null, undefined, userA.id);
    insertAttachment(docs.id, "spec.txt", "typescript style guide");
    const otherChat = createConversation("Other user", null, undefined, userB.id);
    createMessage({ conversationId: otherChat.id, role: "assistant", content: "typescript kubernetes secrets" });
    await runSemanticBackfill();

    const results = await searchWorkspace({ userId: userA.id, query: "typescript kubernetes", limit: 8 });
    expect(results).not.toBeNull();
    const kinds = results!.map((result) => result.kind).sort();
    expect(kinds).toEqual(["attachment", "memory", "message", "message"]);
    expect(results!.find((result) => result.kind === "memory")).toMatchObject({
      title: "Memory (work)",
      memoryId: memory.id,
      conversationId: null
    });
    expect(results!.find((result) => result.conversationId === chat.id)).toMatchObject({ title: "Architecture decision" });
    expect(results!.find((result) => result.conversationId === automation.id)).toMatchObject({ title: "Nightly report" });
    expect(results!.find((result) => result.kind === "attachment")).toMatchObject({ title: "spec.txt in Docs" });
    expect(results!.some((result) => result.conversationId === otherChat.id)).toBe(false);
    expect(results!.every((result) => result.score >= 0.3 && result.date.length > 0)).toBe(true);

    const limited = await searchWorkspace({ userId: userA.id, query: "typescript kubernetes", limit: 2 });
    expect(limited).toHaveLength(2);
    expect(await searchWorkspace({ userId: userA.id, query: "violin", limit: 8 })).toEqual([]);

    fakeEmbeddingState.ready = false;
    expect(await searchWorkspace({ userId: userA.id, query: "typescript", limit: 8 })).toBeNull();
  });

  it("merges semantic conversation hits ahead of lexical ones and falls back to LIKE when unavailable", async () => {
    const user = await createUser("search-merge");
    const semanticOnly = createConversation("Trip", null, undefined, user.id);
    createMessage({ conversationId: semanticOnly.id, role: "user", content: "coffee in paris" });
    const lexicalOnly = createConversation("Paris planning", null, undefined, user.id);
    createMessage({ conversationId: lexicalOnly.id, role: "user", content: "the phrase xyz123 appears here" });
    const both = createConversation("Both", null, undefined, user.id);
    createMessage({ conversationId: both.id, role: "user", content: "paris xyz123" });
    await runSemanticBackfill();

    const merged = await searchConversationsWithRecall("paris", user.id);
    expect(merged.map((conversation) => conversation.id)).toEqual([both.id, semanticOnly.id, lexicalOnly.id]);
    expect(merged[1].matchSnippet).toBe("coffee in paris");

    const paraphrase = await searchConversationsWithRecall("coffee paris", user.id);
    expect(paraphrase.map((conversation) => conversation.id)).toEqual([semanticOnly.id, both.id]);
    expect(searchConversations("coffee paris", user.id)).toEqual([]);
    expect(searchConversations("xyz123", user.id).map((conversation) => conversation.id).sort()).toEqual(
      [both.id, lexicalOnly.id].sort()
    );

    fakeEmbeddingState.ready = false;
    const fallback = await searchConversationsWithRecall("xyz123", user.id);
    expect(fallback.map((conversation) => conversation.id).sort()).toEqual([both.id, lexicalOnly.id].sort());
    expect((await searchConversationsWithRecall("coffee", user.id)).map((conversation) => conversation.id)).toEqual([
      semanticOnly.id
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeEmbeddingModule, fakeEmbeddingState, resetFakeEmbeddingState } from "./fake-embedding-model";

vi.mock("@/lib/local-embedding-model", () => createFakeEmbeddingModule());

import { getDb } from "@/lib/db";
import { createMemory, updateMemory } from "@/lib/memories";
import { RECENT_MEMORY_COUNT, TOP_K_MEMORY_COUNT, selectMemoriesForPrompt } from "@/lib/memory-recall";
import { runSemanticBackfill } from "@/lib/semantic-index";
import { createLocalUser } from "@/lib/users";

async function createUser(username: string) {
  return createLocalUser({ username, password: "Password123!", role: "user" });
}

function setUpdatedAt(memoryId: string, iso: string) {
  getDb().prepare("UPDATE user_memories SET updated_at = ? WHERE id = ?").run(iso, memoryId);
}

describe("selectMemoriesForPrompt", () => {
  beforeEach(() => {
    resetFakeEmbeddingState();
  });

  it("returns null when the index is unavailable", async () => {
    const user = await createUser("recall-unavailable");
    createMemory("montreal", "location", user.id);
    fakeEmbeddingState.ready = false;
    expect(await selectMemoriesForPrompt(user.id, undefined, "montreal")).toBeNull();
  });

  it("returns every memory without embedding when the set already fits", async () => {
    const user = await createUser("recall-small");
    for (let index = 0; index < 5; index += 1) createMemory(`fact ${index}`, "other", user.id);
    await runSemanticBackfill();
    fakeEmbeddingState.embedCalls = 0;

    const selection = await selectMemoriesForPrompt(user.id, undefined, "anything");
    expect(selection).toMatchObject({ total: 5 });
    expect(selection?.selected).toHaveLength(5);
    expect(fakeEmbeddingState.embedCalls).toBe(0);
  });

  it("keeps pinned and recent memories and adds the top-k semantic matches", async () => {
    const user = await createUser("recall-large");
    const filler = Array.from({ length: 60 }, (_, index) =>
      createMemory(`garden note number ${index}`, "other", user.id)
    );
    filler.forEach((memory, index) =>
      setUpdatedAt(memory.id, `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`)
    );
    const pinned = createMemory("violin practice schedule", "other", user.id);
    updateMemory(pinned.id, { pinned: true }, user.id);
    setUpdatedAt(pinned.id, "2025-01-01T00:00:00.000Z");
    const relevant = createMemory("budget for the paris trip", "work", user.id);
    setUpdatedAt(relevant.id, "2025-02-01T00:00:00.000Z");
    const alsoRelevant = createMemory("paris coffee spots", "other", user.id);
    setUpdatedAt(alsoRelevant.id, "2025-03-01T00:00:00.000Z");
    await runSemanticBackfill();

    const selection = await selectMemoriesForPrompt(user.id, undefined, "paris budget");
    expect(selection).not.toBeNull();
    const ids = new Set(selection!.selected.map((memory) => memory.id));

    expect(selection!.total).toBe(63);
    expect(ids.has(pinned.id)).toBe(true);
    expect(ids.has(relevant.id)).toBe(true);
    expect(ids.has(alsoRelevant.id)).toBe(true);
    for (const memory of filler.slice(-RECENT_MEMORY_COUNT)) expect(ids.has(memory.id)).toBe(true);
    expect(selection!.selected.length).toBeLessThanOrEqual(1 + RECENT_MEMORY_COUNT + TOP_K_MEMORY_COUNT);
    expect(selection!.selected.length).toBeLessThan(63);
    expect(selection!.selected[0].id).toBe(pinned.id);
    expect(new Set(selection!.selected.map((memory) => memory.id)).size).toBe(selection!.selected.length);

    const first = selection!.selected.map((memory) => memory.id);
    const second = (await selectMemoriesForPrompt(user.id, undefined, "paris budget"))!.selected.map((memory) => memory.id);
    expect(second).toEqual(first);
  });

  it("falls back to null when the query cannot be embedded", async () => {
    const user = await createUser("recall-empty-query");
    for (let index = 0; index < 40; index += 1) createMemory(`fact ${index}`, "other", user.id);
    await runSemanticBackfill();
    expect(await selectMemoriesForPrompt(user.id, undefined, "   ")).toBeNull();
  });
});

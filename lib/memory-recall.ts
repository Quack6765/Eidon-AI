import { listMemoriesForPrompt, type MemoryScope } from "@/lib/memories";
import { embedQuery, isSemanticRecallAvailable, scoreChunks } from "@/lib/semantic-index";
import type { UserMemory } from "@/lib/types";

export const RECENT_MEMORY_COUNT = 10;
export const TOP_K_MEMORY_COUNT = 25;

export type MemorySelection = {
  selected: UserMemory[];
  total: number;
};

export async function selectMemoriesForPrompt(
  userId: string,
  scope: MemoryScope | undefined,
  queryText: string
): Promise<MemorySelection | null> {
  if (!isSemanticRecallAvailable()) return null;

  const all = listMemoriesForPrompt(userId, scope);
  const total = all.length;
  if (total <= RECENT_MEMORY_COUNT + TOP_K_MEMORY_COUNT) {
    return { selected: all, total };
  }

  const queryVector = await embedQuery(queryText);
  if (!queryVector) return null;

  const keep = new Set<string>();
  for (const memory of all) {
    if (memory.pinned) keep.add(memory.id);
  }
  [...all]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_MEMORY_COUNT)
    .forEach((memory) => keep.add(memory.id));

  const knownIds = new Set(all.map((memory) => memory.id));
  const scored = scoreChunks({
    userId,
    kinds: ["memory"],
    queryVector,
    limit: TOP_K_MEMORY_COUNT * 4,
    memoryBotId: scope?.botId ?? null
  });

  let added = 0;
  for (const chunk of scored) {
    if (added >= TOP_K_MEMORY_COUNT) break;
    if (!knownIds.has(chunk.refId) || keep.has(chunk.refId)) continue;
    keep.add(chunk.refId);
    added += 1;
  }

  return { selected: all.filter((memory) => keep.has(memory.id)), total };
}

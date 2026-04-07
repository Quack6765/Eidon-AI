import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { listMemories, createMemory } from "@/lib/memories";
import { badRequest, ok } from "@/lib/http";
import type { MemoryCategory } from "@/lib/types";

const VALID_CATEGORIES: MemoryCategory[] = ["personal", "preference", "work", "location", "other"];

export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");

  const filter: { category?: string; search?: string } = {};
  if (category && VALID_CATEGORIES.includes(category as MemoryCategory)) {
    filter.category = category;
  }
  if (search) {
    filter.search = search;
  }

  return ok({ memories: listMemories(Object.keys(filter).length ? filter : undefined) });
}

const createSchema = z.object({
  content: z.string().trim().min(1).max(1000),
  category: z.enum(["personal", "preference", "work", "location", "other"])
});

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid memory data");

  return ok({ memory: createMemory(body.data.content, body.data.category) }, { status: 201 });
}

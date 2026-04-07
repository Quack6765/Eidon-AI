import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { updateMemory, deleteMemory } from "@/lib/memories";
import type { MemoryCategory } from "@/lib/types";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({ memoryId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ memoryId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid memory id");

  const { memoryId } = params.data;
  const body = await request.json() as {
    content?: string;
    category?: MemoryCategory;
  };

  const updated = updateMemory(memoryId, body);
  if (!updated) return badRequest("Memory not found", 404);

  return ok({ memory: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ memoryId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid memory id");

  deleteMemory(params.data.memoryId);
  return ok({ success: true });
}

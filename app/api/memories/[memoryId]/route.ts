import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { updateMemory, deleteMemory } from "@/lib/memories";
import type { MemoryCategory } from "@/lib/types";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({ memoryId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ memoryId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "memory id");
  if (params instanceof NextResponse) return params;

  const { memoryId } = params;
  const body = await request.json() as {
    content?: string;
    category?: MemoryCategory;
  };

  const updated = updateMemory(memoryId, body, user.id);
  if (!updated) return badRequest("Memory not found", 404);

  return ok({ memory: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ memoryId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "memory id");
  if (params instanceof NextResponse) return params;

  deleteMemory(params.memoryId, user.id);
  return ok({ success: true });
}

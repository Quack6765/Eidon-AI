import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteSkill, getSkill, updateSkill } from "@/lib/skills";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({ skillId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ skillId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid skill id");

  const { skillId } = params.data;
  const body = await request.json() as {
    name?: string;
    content?: string;
    enabled?: boolean;
  };

  const isBuiltin = skillId.startsWith("builtin-");
  if (isBuiltin && (body.name !== undefined || body.content !== undefined)) {
    return badRequest("Cannot modify name or content of built-in skills");
  }

  const updated = updateSkill(skillId, body);
  if (!updated) return badRequest("Skill not found", 404);

  return ok({ skill: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ skillId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid skill id");

  if (params.data.skillId.startsWith("builtin-")) {
    return badRequest("Cannot delete built-in skills");
  }

  deleteSkill(params.data.skillId);
  return ok({ success: true });
}

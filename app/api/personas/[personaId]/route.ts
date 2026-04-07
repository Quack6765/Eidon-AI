import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { updatePersona, deletePersona } from "@/lib/personas";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({ personaId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ personaId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid persona id");

  const { personaId } = params.data;
  const body = await request.json() as {
    name?: string;
    content?: string;
  };

  const updated = updatePersona(personaId, body);
  if (!updated) return badRequest("Persona not found", 404);

  return ok({ persona: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ personaId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid persona id");

  deletePersona(params.data.personaId);
  return ok({ success: true });
}
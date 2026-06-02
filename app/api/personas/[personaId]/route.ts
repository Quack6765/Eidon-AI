import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { updatePersona, deletePersona } from "@/lib/personas";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({ personaId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ personaId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "persona id");
  if (params instanceof NextResponse) return params;

  const { personaId } = params.data;
  const body = await request.json() as {
    name?: string;
    content?: string;
  };

  const updated = updatePersona(personaId, body, user.id);
  if (!updated) return badRequest("Persona not found", 404);

  return ok({ persona: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ personaId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "persona id");
  if (params instanceof NextResponse) return params;

  deletePersona(params.personaId, user.id);
  return ok({ success: true });
}

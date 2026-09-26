import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { MAX_SECRET_CHARS, SecretRequestError, submitComputerSecret } from "@/lib/computer-secrets";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  actionId: z.string().min(1)
});

const bodySchema = z.object({
  value: z.string().min(1).max(MAX_SECRET_CHARS),
  save: z.boolean().optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "action id");
  if (params instanceof NextResponse) return params;

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Enter a value to fill in");

  try {
    const action = await submitComputerSecret(params.actionId, user.id, {
      value: body.data.value,
      save: body.data.save === true
    });
    return ok({ action });
  } catch (error) {
    if (error instanceof SecretRequestError) return badRequest(error.message, error.status);
    return badRequest("Eidon couldn't type it into the bot's browser.", 502);
  }
}

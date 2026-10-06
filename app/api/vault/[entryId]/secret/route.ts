import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { revealVaultSecret } from "@/lib/vault";

const paramsSchema = z.object({ entryId: z.string().min(1) });

export async function GET(
  _request: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "vault entry id");
  if (params instanceof NextResponse) return params;

  const secret = revealVaultSecret(user.id, params.entryId);
  if (secret === null) return badRequest("Vault entry not found", 404);
  return ok({ secret }, { headers: { "cache-control": "no-store" } });
}

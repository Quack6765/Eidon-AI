import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { deleteVaultEntry, updateVaultEntry, VaultError, vaultEntryUpdateSchema } from "@/lib/vault";

const paramsSchema = z.object({ entryId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "vault entry id");
  if (params instanceof NextResponse) return params;

  const body = vaultEntryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Invalid vault entry");

  try {
    const vaultEntry = updateVaultEntry(user.id, params.entryId, body.data);
    return vaultEntry ? ok({ vaultEntry }) : badRequest("Vault entry not found", 404);
  } catch (error) {
    if (error instanceof VaultError) return badRequest(error.message, error.status);
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "vault entry id");
  if (params instanceof NextResponse) return params;

  if (!deleteVaultEntry(user.id, params.entryId)) return badRequest("Vault entry not found", 404);
  return ok({ success: true });
}

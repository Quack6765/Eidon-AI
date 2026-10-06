import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { createVaultEntry, listVaultEntries, VaultError, vaultEntryCreateSchema } from "@/lib/vault";

export async function GET() {
  const user = await requireUser();
  return ok({ vaultEntries: listVaultEntries(user.id) });
}

export async function POST(request: Request) {
  const user = await requireUser();
  const body = vaultEntryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Invalid vault entry");

  try {
    return ok({ vaultEntry: createVaultEntry(user.id, body.data) }, { status: 201 });
  } catch (error) {
    if (error instanceof VaultError) return badRequest(error.message, error.status);
    throw error;
  }
}

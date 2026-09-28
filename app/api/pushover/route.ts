import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import {
  clearPushoverCredentials,
  pushoverCredentialsConfigured,
  setPushoverCredentials
} from "@/lib/notifications";

const credentialsSchema = z.object({
  userKey: z.string().min(1),
  appToken: z.string().min(1)
});

export async function GET() {
  const user = await requireUser();
  return ok({ configured: pushoverCredentialsConfigured(user.id) });
}

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = credentialsSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Pushover user key and app token are required");
  }

  try {
    setPushoverCredentials(user.id, body.data);
  } catch {
    return badRequest("Pushover user key and app token are required");
  }

  return ok({ configured: true });
}

export async function DELETE() {
  const user = await requireUser();
  clearPushoverCredentials(user.id);
  return ok({ configured: false });
}

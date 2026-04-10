import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { updateGeneralSettingsForUser } from "@/lib/settings";

const generalSettingsSchema = z
  .object({
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]).optional(),
    autoCompaction: z.coerce.boolean().optional(),
    memoriesEnabled: z.coerce.boolean().optional(),
    memoriesMaxCount: z.coerce.number().int().min(1).max(500).optional(),
    mcpTimeout: z.coerce.number().int().min(10_000).max(600_000).optional()
  })
  .strip();

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const payload = generalSettingsSchema.safeParse(body);

  if (!payload.success) {
    return badRequest("Invalid general settings payload");
  }

  return ok({ settings: updateGeneralSettingsForUser(user.id, payload.data) });
}

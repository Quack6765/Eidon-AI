import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getGlobalPreferences } from "@/lib/global-preferences";
import { badRequest, ok } from "@/lib/http";
import { getSanitizedSettings } from "@/lib/settings";
import { updateUserPreferences } from "@/lib/user-preferences";

const inputSchema = z.object({
  defaultView: z.enum(["chat", "agents", "automations"]).optional(),
  toolCallDisplay: z.enum(["pills", "status_line"]).optional(),
  completed: z.boolean().optional()
});

export async function PUT(request: Request) {
  const user = await requireUser();
  const body = inputSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return badRequest(body.error.issues.map((issue) => issue.message).join("; "));
  }
  const { defaultView, toolCallDisplay, completed } = body.data;
  updateUserPreferences(user.id, getGlobalPreferences(), {
    ...(defaultView ? { defaultView } : {}),
    ...(toolCallDisplay ? { toolCallDisplay } : {}),
    ...(completed === undefined ? {} : { hasCompletedOnboarding: completed })
  });
  return ok({ settings: getSanitizedSettings(user.id) });
}

export async function DELETE() {
  const user = await requireUser();
  updateUserPreferences(user.id, getGlobalPreferences(), { hasCompletedOnboarding: false });
  return ok({ settings: getSanitizedSettings(user.id) });
}

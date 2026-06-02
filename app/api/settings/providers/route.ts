import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { updateProviderCatalog } from "@/lib/settings";

export async function PUT(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  try {
    const payload = await request.json();
    return ok({ settings: updateProviderCatalog(payload) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).join("; ");
      return badRequest(message);
    }
    return badRequest(error instanceof Error ? error.message : "Unable to update provider settings");
  }
}

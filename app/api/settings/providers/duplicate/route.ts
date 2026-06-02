import { z } from "zod";

import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { duplicateProviderProfile } from "@/lib/settings";

const duplicateSchema = z.object({
  sourceProfileId: z.string().min(1)
});

export async function POST(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  try {
    const body = duplicateSchema.parse(await request.json());
    const settings = duplicateProviderProfile(body.sourceProfileId);
    return ok({ settings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).join("; ");
      return badRequest(message);
    }
    return badRequest(
      error instanceof Error ? error.message : "Unable to duplicate provider profile"
    );
  }
}

import { requireAdminUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { updateProviderCatalog } from "@/lib/settings";

export async function PUT(request: Request) {
  await requireAdminUser();

  try {
    const payload = await request.json();
    return ok({ settings: updateProviderCatalog(payload) });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to update provider settings");
  }
}

import { requireAdminUser } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { updateProviderCatalog } from "@/lib/settings";

export async function PUT(request: Request) {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  try {
    const payload = await request.json();
    return ok({ settings: updateProviderCatalog(payload) });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to update provider settings");
  }
}

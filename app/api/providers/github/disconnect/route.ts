import { requireAdminUser } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { clearGithubCopilotCredentials } from "@/lib/settings";

export async function POST(request: Request) {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return forbidden();
    }
    throw error;
  }

  const body = await request.json().catch(() => ({}));
  const { providerProfileId } = body as { providerProfileId?: string };

  if (!providerProfileId) {
    return badRequest("Provider profile is required");
  }

  clearGithubCopilotCredentials(providerProfileId);

  return ok({ success: true });
}

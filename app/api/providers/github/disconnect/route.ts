import { requireAdminResponse } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";
import { clearGithubCopilotCredentials } from "@/lib/settings";

export async function POST(request: Request) {
  const admin = await requireAdminResponse();
  if (!admin) return forbidden();

  const body = await request.json().catch(() => ({}));
  const { providerProfileId } = body as { providerProfileId?: string };

  if (!providerProfileId) {
    return badRequest("Provider profile is required");
  }

  clearGithubCopilotCredentials(providerProfileId);

  return ok({ success: true });
}

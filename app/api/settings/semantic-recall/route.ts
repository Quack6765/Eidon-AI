import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { getSemanticIndexStatus, rebuildSemanticIndex } from "@/lib/semantic-index";
import { getSettings } from "@/lib/settings";

export async function GET() {
  await requireUser();
  return ok({ status: { ...getSemanticIndexStatus(), enabled: getSettings().semanticRecallEnabled } });
}

export async function POST() {
  const user = await requireUser();
  if (user.role !== "admin") {
    return badRequest("Only admins can rebuild the semantic index", 403);
  }
  if (!getSettings().semanticRecallEnabled) {
    return badRequest("Semantic recall is disabled");
  }
  console.log(`[semantic-index] Rebuild requested by ${user.username}`);
  void rebuildSemanticIndex().catch((error) => {
    console.error("[semantic-index] Rebuild failed:", error instanceof Error ? error.message : error);
  });
  return ok({ status: { ...getSemanticIndexStatus(), enabled: true } });
}

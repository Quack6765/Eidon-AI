import { requireUser } from "@/lib/auth";
import { searchConversations } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  if (!query.trim()) {
    return badRequest("Missing search query");
  }

  return ok({ conversations: searchConversations(query) });
}

import { requireUser } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/conversations";
import { ok } from "@/lib/http";

export async function GET() {
  await requireUser();
  return ok({ conversations: listConversations() });
}

export async function POST() {
  await requireUser();
  return ok({ conversation: createConversation() }, { status: 201 });
}

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { ensureChiefBot } from "@/lib/bots";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const user = await requireUser();
  const chief = ensureChiefBot(user.id);

  redirect(`/agents/${chief.id}`);
}

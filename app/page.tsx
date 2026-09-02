import { ChatHomePage } from "@/components/chat-home-page";
import { requireUser } from "@/lib/auth";
import { getSanitizedSettings } from "@/lib/settings";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const settings = getSanitizedSettings(user.id);
  if (settings.defaultView !== "chat") {
    redirect(settings.defaultView === "agents" ? "/agents" : "/automations");
  }
  return <ChatHomePage />;
}

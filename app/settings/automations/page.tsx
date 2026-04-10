import { AutomationsSection } from "@/components/settings/sections/automations-section";
import { requireUser } from "@/lib/auth";

export default async function AutomationsPage() {
  await requireUser();
  return <AutomationsSection />;
}

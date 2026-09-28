import { GeneralSection } from "@/components/settings/sections/general-section";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";
import { getIsolationStatus } from "@/lib/shell-isolation";

export default async function GeneralPage() {
  const user = await requireUser();
  const settings = getSanitizedSettings(user.id);

  return (
    <GeneralSection
      settings={settings}
      canManageGlobalIntegrations={user.role === "admin"}
      botIsolation={getIsolationStatus()}
    />
  );
}

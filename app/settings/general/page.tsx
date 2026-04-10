import { GeneralSection } from "@/components/settings/sections/general-section";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

export default async function GeneralPage() {
  const user = await requireUser();
  const settings = getSanitizedSettings(user.id);

  return <GeneralSection settings={settings} />;
}

import { GeneralSection } from "@/components/settings/sections/general-section";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

export default async function GeneralPage() {
  await requireUser();
  const settings = getSanitizedSettings();

  return <GeneralSection settings={settings} />;
}

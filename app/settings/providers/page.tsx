import { ProvidersSection } from "@/components/settings/sections/providers-section";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

export default async function ProvidersPage() {
  await requireUser();
  const settings = getSanitizedSettings();

  return <ProvidersSection settings={settings} />;
}

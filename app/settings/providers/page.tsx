import { notFound } from "next/navigation";

import { ProvidersSection } from "@/components/settings/sections/providers-section";
import { getSanitizedSettings } from "@/lib/settings";
import { requireAdminUser } from "@/lib/auth";

export default async function ProvidersPage() {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      notFound();
    }
    throw error;
  }

  const settings = getSanitizedSettings();

  return <ProvidersSection settings={settings} />;
}

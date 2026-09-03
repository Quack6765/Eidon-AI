import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { requireUser } from "@/lib/auth";
import { getSanitizedSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const settings = getSanitizedSettings(user.id);
  if (settings.hasCompletedOnboarding) {
    redirect("/");
  }

  return (
    <main className="min-h-dvh bg-[var(--background)]">
      <OnboardingFlow
        role={user.role}
        settings={{
          defaultView: settings.defaultView,
          toolCallDisplay: settings.toolCallDisplay,
          defaultProviderProfileId: settings.defaultProviderProfileId,
          providerProfiles: settings.providerProfiles,
          skillsEnabled: settings.skillsEnabled
        }}
      />
    </main>
  );
}

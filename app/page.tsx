import { HomeView } from "@/components/home-view";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { listConversationsPage } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { getSanitizedSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireUser();
  const conversationPage = listConversationsPage();
  const folders = listFolders();
  const settings = getSanitizedSettings();

  return (
    <Shell conversationPage={conversationPage} folders={folders}>
      <HomeView
        providerProfiles={settings.providerProfiles}
        defaultProviderProfileId={settings.defaultProviderProfileId}
      />
    </Shell>
  );
}

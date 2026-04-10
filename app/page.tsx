import { HomeView } from "@/components/home-view";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { listConversationsPage } from "@/lib/conversations";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";
import { getSanitizedSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const conversationPage = listConversationsPage({ userId: user.id });
  const folders = listFolders(user.id);
  const settings = getSanitizedSettings(user.id);

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={conversationPage}
      folders={folders}
    >
      <HomeView
        providerProfiles={settings.providerProfiles}
        defaultProviderProfileId={settings.defaultProviderProfileId}
      />
    </Shell>
  );
}

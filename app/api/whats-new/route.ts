import { requireUser } from "@/lib/auth";
import { getAppVersion } from "@/lib/constants";
import { getGlobalPreferences } from "@/lib/global-preferences";
import { ok } from "@/lib/http";
import { buildReleaseAnnouncement } from "@/lib/release-highlights";
import { getUserPreferences, updateUserPreferences } from "@/lib/user-preferences";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const preferences = getUserPreferences(user.id, getGlobalPreferences());
  const whatsNew = buildReleaseAnnouncement({
    currentVersion: getAppVersion(),
    lastSeenVersion: preferences.lastSeenRelease
  });

  return ok({ whatsNew }, { headers: { "cache-control": "no-store" } });
}

export async function POST() {
  const user = await requireUser();
  const version = getAppVersion();
  updateUserPreferences(user.id, getGlobalPreferences(), { lastSeenRelease: version });

  return ok({ seenReleaseVersion: version });
}

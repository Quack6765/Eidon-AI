import {
  APP_NAME,
  MAX_ATTACHMENTS_PER_UPLOAD,
  MAX_ATTACHMENT_BYTES,
  MOBILE_API_MINIMUM_SERVER_VERSION,
  MOBILE_API_VERSION,
  MOBILE_WEBSOCKET_PATH
} from "@/lib/constants";
import { isPasswordLoginEnabled } from "@/lib/env";
import { mobileApiSuccess } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return mobileApiSuccess(
    {
      applicationName: APP_NAME,
      releaseVersion: process.env.NEXT_PUBLIC_APP_VERSION || "dev",
      supportedApiVersions: [MOBILE_API_VERSION],
      passwordLoginAvailable: isPasswordLoginEnabled(),
      websocketPath: MOBILE_WEBSOCKET_PATH,
      minimumClientVersion: null,
      minimumNativeCompatibleServerVersion: MOBILE_API_MINIMUM_SERVER_VERSION,
      capabilities: {
        conversations: true,
        folders: true,
        search: true,
        sharing: true,
        attachments: true,
        automations: true,
        personas: true,
        memories: true,
        administratorSettings: true,
        githubCopilotOAuth: true,
        offlineMutations: false,
        pushNotifications: false
      },
      attachmentLimits: {
        maxCountPerUpload: MAX_ATTACHMENTS_PER_UPLOAD,
        maxBytesPerAttachment: MAX_ATTACHMENT_BYTES
      }
    },
    { headers: { "cache-control": "no-store" } }
  );
}

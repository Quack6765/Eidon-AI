import {
  CHATGPT_DEVICE_CODE_LIFETIME_MS,
  CHATGPT_DEVICE_VERIFICATION_URL,
  exchangeChatgptAuthorizationCode,
  pollChatgptDeviceAuthorization,
  requestChatgptDeviceCode
} from "@/lib/chatgpt-subscription";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import {
  cancelProviderConnectionFlow,
  claimProviderConnectionFlow,
  getProviderConnectionFlow,
  getProviderConnectionFlowRow,
  insertProviderConnectionFlow,
  setProviderConnectionFlowStatus
} from "@/lib/provider-connection-flows";
import {
  claimProviderConnectionAttempt,
  getProviderProfile,
  updateProviderConnectionIfNonceMatches
} from "@/lib/provider-profiles";
import type { AuthUser } from "@/lib/types";

type DeviceFlowState = {
  profileNonce: string;
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
  nextPollAt: number;
};

function parseDeviceFlowState(stateJson: string): DeviceFlowState | null {
  try {
    const state = JSON.parse(stateJson) as Partial<DeviceFlowState>;
    if (
      typeof state.profileNonce !== "string" ||
      typeof state.deviceAuthId !== "string" ||
      typeof state.userCode !== "string" ||
      typeof state.intervalSeconds !== "number" ||
      typeof state.nextPollAt !== "number"
    ) {
      return null;
    }
    return state as DeviceFlowState;
  } catch {
    return null;
  }
}

function claimPollSlot(flowId: string, state: DeviceFlowState, now: number) {
  const result = getDb()
    .prepare(
      `UPDATE provider_connection_flows
       SET state_json = json_set(state_json, '$.nextPollAt', ?)
       WHERE id = ?
         AND status = 'pending'
         AND consumed_at IS NULL
         AND json_extract(state_json, '$.nextPollAt') <= ?`
    )
    .run(now + state.intervalSeconds * 1000, flowId, now);
  return result.changes === 1;
}

function failFlow(flowId: string) {
  getDb()
    .prepare(
      `UPDATE provider_connection_flows
       SET consumed_at = COALESCE(consumed_at, ?), status = 'failed'
       WHERE id = ? AND status IN ('pending', 'processing')`
    )
    .run(new Date().toISOString(), flowId);
}

export async function createChatgptProviderConnectionFlow(user: AuthUser, profileId: string) {
  if (user.role !== "admin") throw new Error("Only administrators can connect a ChatGPT subscription");

  const profile = getProviderProfile(profileId);
  if (!profile || profile.providerKind !== "chatgpt_subscription") {
    throw new Error("ChatGPT subscription profile not found");
  }

  const deviceCode = await requestChatgptDeviceCode();
  const profileNonce = claimProviderConnectionAttempt(profile.id);
  if (!profileNonce) throw new Error("ChatGPT subscription profile changed before connection started");

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CHATGPT_DEVICE_CODE_LIFETIME_MS);
  const flowId = insertProviderConnectionFlow({
    userId: user.id,
    profileId: profile.id,
    providerKind: "chatgpt_subscription",
    state: {
      profileNonce,
      deviceAuthId: encryptValue(deviceCode.deviceAuthId),
      userCode: deviceCode.userCode,
      intervalSeconds: deviceCode.intervalSeconds,
      nextPollAt: createdAt.getTime() + deviceCode.intervalSeconds * 1000
    } satisfies DeviceFlowState,
    createdAt,
    expiresAt
  });

  return {
    flowId,
    authorizationUrl: CHATGPT_DEVICE_VERIFICATION_URL,
    userCode: deviceCode.userCode,
    expiresAt: expiresAt.toISOString()
  };
}

export async function pollChatgptProviderConnectionFlow(flowId: string, userId: string) {
  const flow = getProviderConnectionFlowRow(flowId);
  if (!flow || flow.user_id !== userId || flow.status !== "pending" || flow.consumed_at) return;

  const state = parseDeviceFlowState(flow.state_json);
  const now = Date.now();
  if (!state || Date.parse(flow.expires_at) <= now) {
    failFlow(flowId);
    return;
  }
  if (!claimPollSlot(flowId, state, now)) return;

  try {
    const poll = await pollChatgptDeviceAuthorization(decryptValue(state.deviceAuthId), state.userCode);
    if (poll.status === "pending") return;

    const claimed = claimProviderConnectionFlow({
      flowId,
      userId,
      profileId: flow.profile_id,
      profileNonce: state.profileNonce
    });
    if (!claimed) {
      failFlow(flowId);
      return;
    }

    const tokens = await exchangeChatgptAuthorizationCode(poll.authorizationCode, poll.codeVerifier);
    const updated = updateProviderConnectionIfNonceMatches(flow.profile_id, state.profileNonce, {
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      },
      metadata: {
        expiresAt: tokens.expiresAt,
        accountLabel: tokens.accountLabel,
        ownerUserId: flow.user_id
      }
    });
    if (updated) setProviderConnectionFlowStatus(flowId, "succeeded");
    else failFlow(flowId);
  } catch (error) {
    console.error("[chatgpt-provider-connection] device flow failed", {
      flowId,
      error: error instanceof Error ? error.message : "UnknownError"
    });
    failFlow(flowId);
  }
}

export const chatgptSubscriptionConnectionFlows = {
  create: createChatgptProviderConnectionFlow,
  get: getProviderConnectionFlow,
  poll: pollChatgptProviderConnectionFlow,
  cancel: cancelProviderConnectionFlow
};

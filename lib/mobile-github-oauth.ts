import { createHash } from "node:crypto";

import { decodeJwt, jwtVerify, SignJWT } from "jose";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import {
  exchangeGithubCodeForTokens,
  getGithubAuthorizeUrl
} from "@/lib/github-copilot";
import { createId } from "@/lib/ids";
import {
  claimGithubCopilotConnectionAttempt,
  getProviderProfile,
  updateGithubCopilotCredentialsIfNonceMatches
} from "@/lib/settings";
import type { AuthUser } from "@/lib/types";

const mobileGithubStateUse = "github_mobile_oauth_state";
const mobileGithubStateAudience = "eidon-github-mobile-oauth";
const mobileGithubFlowDurationMs = 10 * 60 * 1000;

type MobileGithubState = {
  flowId: string;
  userId: string;
  profileId: string;
  profileNonce: string;
};

type MobileGithubFlowRow = {
  id: string;
  user_id: string;
  profile_id: string;
  profile_nonce: string;
  expires_at: string;
  consumed_at: string | null;
  status: string;
  created_at: string;
};

function getMobileGithubStateSecret() {
  return createHash("sha256")
    .update("eidon-github-mobile-oauth-v1\0")
    .update(env.EIDON_SESSION_SECRET)
    .digest();
}

async function createMobileGithubState(input: MobileGithubState) {
  return new SignJWT({ ...input, tokenUse: mobileGithubStateUse })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("eidon")
    .setAudience(mobileGithubStateAudience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getMobileGithubStateSecret());
}

function isMobileGithubState(state: string) {
  try {
    return decodeJwt(state).tokenUse === mobileGithubStateUse;
  } catch {
    return false;
  }
}

async function verifyMobileGithubState(state: string): Promise<MobileGithubState> {
  const { payload } = await jwtVerify(state, getMobileGithubStateSecret(), {
    algorithms: ["HS256"],
    issuer: "eidon",
    audience: mobileGithubStateAudience
  });
  const values = [payload.flowId, payload.userId, payload.profileId, payload.profileNonce];
  if (
    payload.tokenUse !== mobileGithubStateUse ||
    values.some((value) => typeof value !== "string" || !value.trim())
  ) {
    throw new Error("Invalid mobile GitHub OAuth state");
  }

  return {
    flowId: payload.flowId as string,
    userId: payload.userId as string,
    profileId: payload.profileId as string,
    profileNonce: payload.profileNonce as string
  };
}

function getMobileGithubFlow(flowId: string) {
  return getDb()
    .prepare(
      `SELECT id, user_id, profile_id, profile_nonce, expires_at, consumed_at, status, created_at
       FROM mobile_github_oauth_flows
       WHERE id = ?`
    )
    .get(flowId) as MobileGithubFlowRow | undefined;
}

function mobileRedirect(flowId: string, status: "success" | "failure") {
  const destination = new URL("eidon://oauth/github");
  destination.searchParams.set("flowId", flowId);
  destination.searchParams.set("status", status);
  return new Response(null, {
    status: 303,
    headers: {
      location: destination.toString(),
      "cache-control": "no-store"
    }
  });
}

function setFlowStatus(flowId: string, status: string) {
  getDb()
    .prepare("UPDATE mobile_github_oauth_flows SET status = ? WHERE id = ?")
    .run(status, flowId);
}

export async function createMobileGithubOauthFlow(user: AuthUser, profileId: string) {
  if (user.role !== "admin") throw new Error("Only administrators can connect GitHub Copilot");
  if (
    !env.EIDON_GITHUB_APP_CLIENT_ID ||
    !env.EIDON_GITHUB_APP_CLIENT_SECRET ||
    !env.EIDON_GITHUB_APP_CALLBACK_URL
  ) {
    throw new Error("GitHub OAuth is not configured");
  }

  const profile = getProviderProfile(profileId);
  if (!profile || profile.providerKind !== "github_copilot") {
    throw new Error("GitHub Copilot profile not found");
  }

  const profileNonce = claimGithubCopilotConnectionAttempt(profile.id);
  if (!profileNonce) throw new Error("GitHub Copilot profile changed before connection started");

  const flowId = createId("mobile_github_oauth");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + mobileGithubFlowDurationMs);
  getDb()
    .prepare(
      `INSERT INTO mobile_github_oauth_flows (
        id, user_id, profile_id, profile_nonce, expires_at, consumed_at, status, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?)`
    )
    .run(
      flowId,
      user.id,
      profile.id,
      profileNonce,
      expiresAt.toISOString(),
      createdAt.toISOString()
    );

  const state = await createMobileGithubState({
    flowId,
    userId: user.id,
    profileId: profile.id,
    profileNonce
  });
  return {
    flowId,
    authorizationUrl: getGithubAuthorizeUrl(state),
    expiresAt: expiresAt.toISOString()
  };
}

export function getMobileGithubOauthFlowForUser(flowId: string, userId: string) {
  const flow = getMobileGithubFlow(flowId);
  if (!flow || flow.user_id !== userId) return null;
  return {
    id: flow.id,
    profileId: flow.profile_id,
    expiresAt: flow.expires_at,
    status: flow.status,
    createdAt: flow.created_at
  };
}

export function cancelMobileGithubOauthFlow(flowId: string, userId: string) {
  const result = getDb()
    .prepare(
      `UPDATE mobile_github_oauth_flows
       SET consumed_at = ?, status = 'canceled'
       WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND status = 'pending'`
    )
    .run(new Date().toISOString(), flowId, userId);
  return result.changes === 1;
}

function claimMobileGithubFlow(state: MobileGithubState) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE mobile_github_oauth_flows
       SET consumed_at = ?, status = 'processing'
       WHERE id = ?
         AND user_id = ?
         AND profile_id = ?
         AND profile_nonce = ?
         AND consumed_at IS NULL
         AND status = 'pending'
         AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM users
           WHERE users.id = mobile_github_oauth_flows.user_id
             AND users.role = 'admin'
         )
         AND EXISTS (
           SELECT 1 FROM provider_profiles
           WHERE provider_profiles.id = mobile_github_oauth_flows.profile_id
             AND provider_profiles.provider_kind = 'github_copilot'
             AND provider_profiles.github_oauth_nonce = mobile_github_oauth_flows.profile_nonce
         )`
    )
    .run(
      now,
      state.flowId,
      state.userId,
      state.profileId,
      state.profileNonce,
      now
    );
  return result.changes === 1;
}

export async function handleMobileGithubOauthCallback(request: Request) {
  const url = new URL(request.url);
  const stateToken = url.searchParams.get("state");
  if (!stateToken || !isMobileGithubState(stateToken)) return null;

  let state: MobileGithubState;
  try {
    state = await verifyMobileGithubState(stateToken);
  } catch {
    return new Response("Invalid or expired OAuth state", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  if (!claimMobileGithubFlow(state)) {
    return mobileRedirect(state.flowId, "failure");
  }

  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!code || oauthError) {
    setFlowStatus(state.flowId, oauthError === "access_denied" ? "canceled" : "failed");
    return mobileRedirect(state.flowId, "failure");
  }

  try {
    const profile = getProviderProfile(state.profileId);
    if (!profile || profile.providerKind !== "github_copilot") {
      setFlowStatus(state.flowId, "failed");
      return mobileRedirect(state.flowId, "failure");
    }

    const tokens = await exchangeGithubCodeForTokens(code);
    const updated = updateGithubCopilotCredentialsIfNonceMatches(
      state.profileId,
      state.profileNonce,
      {
        githubUserAccessToken: tokens.access_token,
        githubRefreshToken: tokens.refresh_token ?? "",
        githubTokenExpiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        githubRefreshTokenExpiresAt: tokens.refresh_token_expires_in
          ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000).toISOString()
          : null,
        githubAccountLogin: null,
        githubAccountName: null
      }
    );

    setFlowStatus(state.flowId, updated ? "succeeded" : "failed");
    return mobileRedirect(state.flowId, updated ? "success" : "failure");
  } catch (error) {
    console.error("[mobile-github-oauth] callback failed", {
      flowId: state.flowId,
      error: error instanceof Error ? error.name : "UnknownError"
    });
    setFlowStatus(state.flowId, "failed");
    return mobileRedirect(state.flowId, "failure");
  }
}

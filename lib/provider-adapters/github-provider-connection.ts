import { createHash } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import {
  exchangeGithubCodeForTokens,
  getGithubAuthorizeUrl,
  updateGithubCopilotConnectionIfNonceMatches
} from "@/lib/github-copilot";
import { createId } from "@/lib/ids";
import {
  claimProviderConnectionAttempt,
  getProviderProfile
} from "@/lib/provider-profiles";
import type { AuthUser } from "@/lib/types";

const githubConnectionStateUse = "github_provider_connection_state";
const githubConnectionStateAudience = "eidon-github-provider-connection";
const githubConnectionFlowDurationMs = 10 * 60 * 1000;

type ProviderConnectionClient = "native" | "browser";

type GithubConnectionState = {
  flowId: string;
  userId: string;
  profileId: string;
  profileNonce: string;
  client: ProviderConnectionClient;
};

type GithubConnectionFlowRow = {
  id: string;
  user_id: string;
  profile_id: string;
  provider_kind: string;
  state_json: string;
  expires_at: string;
  consumed_at: string | null;
  status: string;
  created_at: string;
};

function getGithubConnectionStateSecret() {
  return createHash("sha256")
    .update("eidon-github-provider-connection-v1\0")
    .update(env.EIDON_SESSION_SECRET)
    .digest();
}

async function createGithubConnectionState(input: GithubConnectionState) {
  return new SignJWT({ ...input, tokenUse: githubConnectionStateUse })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("eidon")
    .setAudience(githubConnectionStateAudience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getGithubConnectionStateSecret());
}

async function verifyGithubConnectionState(state: string): Promise<GithubConnectionState> {
  const { payload } = await jwtVerify(state, getGithubConnectionStateSecret(), {
    algorithms: ["HS256"],
    issuer: "eidon",
    audience: githubConnectionStateAudience
  });
  const values = [payload.flowId, payload.userId, payload.profileId, payload.profileNonce];
  if (
    payload.tokenUse !== githubConnectionStateUse ||
    (payload.client !== "native" && payload.client !== "browser") ||
    values.some((value) => typeof value !== "string" || !value.trim())
  ) {
    throw new Error("Invalid GitHub provider connection state");
  }

  return {
    flowId: payload.flowId as string,
    userId: payload.userId as string,
    profileId: payload.profileId as string,
    profileNonce: payload.profileNonce as string,
    client: payload.client
  };
}

function getGithubConnectionFlow(flowId: string) {
  return getDb()
    .prepare(
      `SELECT id, user_id, profile_id, provider_kind, state_json,
        expires_at, consumed_at, status, created_at
       FROM provider_connection_flows
       WHERE id = ?`
    )
    .get(flowId) as GithubConnectionFlowRow | undefined;
}

function nativeRedirect(flowId: string, status: "success" | "failure") {
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

function connectionResultResponse(
  state: GithubConnectionState,
  status: "success" | "failure"
) {
  if (state.client === "native") return nativeRedirect(state.flowId, status);
  const destination = new URL("/settings/providers", env.EIDON_GITHUB_APP_CALLBACK_URL);
  destination.searchParams.set("connection", status);
  return new Response(null, {
    status: 303,
    headers: { location: destination.toString(), "cache-control": "no-store" }
  });
}

function setFlowStatus(flowId: string, status: string) {
  getDb()
    .prepare("UPDATE provider_connection_flows SET status = ? WHERE id = ?")
    .run(status, flowId);
}

export async function createGithubProviderConnectionFlow(
  user: AuthUser,
  profileId: string,
  input?: { client?: ProviderConnectionClient }
) {
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

  const profileNonce = claimProviderConnectionAttempt(profile.id);
  if (!profileNonce) throw new Error("GitHub Copilot profile changed before connection started");

  const flowId = createId("provider_connection_flow");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + githubConnectionFlowDurationMs);
  const client = input?.client ?? "native";
  getDb()
    .prepare(
      `INSERT INTO provider_connection_flows (
        id, user_id, profile_id, provider_kind, state_json,
        expires_at, consumed_at, status, created_at
       ) VALUES (?, ?, ?, 'github_copilot', ?, ?, NULL, 'pending', ?)`
    )
    .run(
      flowId,
      user.id,
      profile.id,
      JSON.stringify({ profileNonce, client }),
      expiresAt.toISOString(),
      createdAt.toISOString()
    );

  const state = await createGithubConnectionState({
    flowId,
    userId: user.id,
    profileId: profile.id,
    profileNonce,
    client
  });
  return {
    flowId,
    authorizationUrl: getGithubAuthorizeUrl(state),
    expiresAt: expiresAt.toISOString()
  };
}

export function getGithubProviderConnectionFlow(flowId: string, userId: string) {
  const flow = getGithubConnectionFlow(flowId);
  if (!flow || flow.user_id !== userId) return null;
  return {
    id: flow.id,
    profileId: flow.profile_id,
    expiresAt: flow.expires_at,
    status: flow.status,
    createdAt: flow.created_at
  };
}

export function cancelGithubProviderConnectionFlow(flowId: string, userId: string) {
  const result = getDb()
    .prepare(
      `UPDATE provider_connection_flows
       SET consumed_at = ?, status = 'canceled'
       WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND status = 'pending'`
    )
    .run(new Date().toISOString(), flowId, userId);
  return result.changes === 1;
}

function claimGithubConnectionFlow(state: GithubConnectionState) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE provider_connection_flows
       SET consumed_at = ?, status = 'processing'
       WHERE id = ?
         AND user_id = ?
         AND profile_id = ?
         AND json_extract(state_json, '$.profileNonce') = ?
         AND consumed_at IS NULL
         AND status = 'pending'
         AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM users
           WHERE users.id = provider_connection_flows.user_id
             AND users.role = 'admin'
         )
         AND EXISTS (
           SELECT 1
           FROM provider_profile_connections
           JOIN provider_profiles
             ON provider_profiles.id = provider_profile_connections.profile_id
           WHERE provider_profile_connections.profile_id = provider_connection_flows.profile_id
             AND provider_profiles.provider_kind = provider_connection_flows.provider_kind
             AND provider_profile_connections.oauth_nonce = json_extract(provider_connection_flows.state_json, '$.profileNonce')
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

export async function handleGithubProviderConnectionCallback(request: Request) {
  const url = new URL(request.url);
  const stateToken = url.searchParams.get("state");
  if (!stateToken) {
    return new Response("Missing OAuth state", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  let state: GithubConnectionState;
  try {
    state = await verifyGithubConnectionState(stateToken);
  } catch {
    return new Response("Invalid or expired OAuth state", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  if (!claimGithubConnectionFlow(state)) {
    return connectionResultResponse(state, "failure");
  }

  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!code || oauthError) {
    setFlowStatus(state.flowId, oauthError === "access_denied" ? "canceled" : "failed");
    return connectionResultResponse(state, "failure");
  }

  try {
    const profile = getProviderProfile(state.profileId);
    if (!profile || profile.providerKind !== "github_copilot") {
      setFlowStatus(state.flowId, "failed");
      return connectionResultResponse(state, "failure");
    }

    const tokens = await exchangeGithubCodeForTokens(code);
    const updated = updateGithubCopilotConnectionIfNonceMatches(
      state.profileId,
      state.profileNonce,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? "",
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        refreshExpiresAt: tokens.refresh_token_expires_in
          ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000).toISOString()
          : null,
        accountLogin: null,
        accountName: null
      }
    );

    setFlowStatus(state.flowId, updated ? "succeeded" : "failed");
    return connectionResultResponse(state, updated ? "success" : "failure");
  } catch (error) {
    console.error("[github-provider-connection] callback failed", {
      flowId: state.flowId,
      error: error instanceof Error ? error.name : "UnknownError"
    });
    setFlowStatus(state.flowId, "failed");
    return connectionResultResponse(state, "failure");
  }
}

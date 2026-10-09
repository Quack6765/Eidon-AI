import { createHash } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import { env, getGithubAppCallbackUrl } from "@/lib/env";
import {
  exchangeGithubCodeForTokens,
  getGithubAuthorizeUrl,
  updateGithubCopilotConnectionIfNonceMatches
} from "@/lib/github-copilot";
import {
  claimProviderConnectionFlow,
  insertProviderConnectionFlow,
  setProviderConnectionFlowStatus
} from "@/lib/provider-connection-flows";
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
  const destination = new URL("/settings/providers", getGithubAppCallbackUrl()!);
  destination.searchParams.set("connection", status);
  return new Response(null, {
    status: 303,
    headers: { location: destination.toString(), "cache-control": "no-store" }
  });
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
    !getGithubAppCallbackUrl()
  ) {
    throw new Error("GitHub OAuth is not configured");
  }

  const profile = getProviderProfile(profileId);
  if (!profile || profile.providerKind !== "github_copilot") {
    throw new Error("GitHub Copilot profile not found");
  }

  const profileNonce = claimProviderConnectionAttempt(profile.id);
  if (!profileNonce) throw new Error("GitHub Copilot profile changed before connection started");

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + githubConnectionFlowDurationMs);
  const client = input?.client ?? "native";
  const flowId = insertProviderConnectionFlow({
    userId: user.id,
    profileId: profile.id,
    providerKind: "github_copilot",
    state: { profileNonce, client },
    createdAt,
    expiresAt
  });

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

  if (!claimProviderConnectionFlow(state)) {
    return connectionResultResponse(state, "failure");
  }

  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!code || oauthError) {
    setProviderConnectionFlowStatus(state.flowId, oauthError === "access_denied" ? "canceled" : "failed");
    return connectionResultResponse(state, "failure");
  }

  try {
    const profile = getProviderProfile(state.profileId);
    if (!profile || profile.providerKind !== "github_copilot") {
      setProviderConnectionFlowStatus(state.flowId, "failed");
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

    setProviderConnectionFlowStatus(state.flowId, updated ? "succeeded" : "failed");
    return connectionResultResponse(state, updated ? "success" : "failure");
  } catch (error) {
    console.error("[github-provider-connection] callback failed", {
      flowId: state.flowId,
      error: error instanceof Error ? error.name : "UnknownError"
    });
    setProviderConnectionFlowStatus(state.flowId, "failed");
    return connectionResultResponse(state, "failure");
  }
}

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SignJWT, jwtVerify } from "jose";
import { CopilotClient } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { env } from "@/lib/env";
import type {
  GithubConnectionStatus,
  ProviderProfile,
  ProviderProfileWithApiKey
} from "@/lib/types";
import { updateGithubCopilotCredentialsIfRefreshTokenMatches } from "@/lib/settings";

const COPILOT_WORK_DIR = join(tmpdir(), "eidon-copilot");
const GITHUB_OAUTH_STATE_USE = "github_oauth_state";
const GITHUB_OAUTH_STATE_ISSUER = "eidon";
const GITHUB_OAUTH_STATE_AUDIENCE = "eidon-github-oauth";

const COPILOT_EXCLUDED_TOOLS: string[] = [
  "browser_start_debugger",
  "browser_tool",
  "query_system_config",
  "read_task_specification",
  "write_task_specification",
  "agent_github_mcp"
];

function ensureCopilotWorkDir(): string {
  mkdirSync(COPILOT_WORK_DIR, { recursive: true });
  return COPILOT_WORK_DIR;
}

type GithubConnectionInput = Pick<
  ProviderProfile,
  "providerKind" | "githubUserAccessTokenEncrypted" | "githubTokenExpiresAt"
>;

type GithubRefreshInput = Pick<ProviderProfile, "githubTokenExpiresAt">;

type GithubClearInput = Pick<
  ProviderProfile,
  | "githubUserAccessTokenEncrypted"
  | "githubRefreshTokenEncrypted"
  | "githubTokenExpiresAt"
  | "githubRefreshTokenExpiresAt"
  | "githubAccountLogin"
  | "githubAccountName"
>;

type GithubClearOutput = {
  [K in keyof GithubClearInput]: K extends `${string}Encrypted` ? string : string | null;
};

const REFRESH_THRESHOLD_MS = 2 * 60 * 1000;
const GITHUB_REFRESH_REGISTRY_KEY = Symbol.for("eidon:github-copilot-refreshes");
type GithubRefreshEntry = {
  refreshTokenVersion: string;
  promise: Promise<ProviderProfileWithApiKey>;
};

function getGithubRefreshes() {
  const runtime = globalThis as Record<symbol, Map<string, GithubRefreshEntry> | undefined>;
  let registry = runtime[GITHUB_REFRESH_REGISTRY_KEY];
  if (!registry) {
    registry = new Map<string, GithubRefreshEntry>();
    runtime[GITHUB_REFRESH_REGISTRY_KEY] = registry;
  }
  return registry;
}

type GithubTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};
type ValidGithubTokenResponse = GithubTokenResponse & { access_token: string };

async function parseGithubTokenResponse(response: Response): Promise<ValidGithubTokenResponse> {
  if (response.ok === false) {
    throw new Error(`GitHub OAuth request failed with status ${response.status}`);
  }

  const tokens = await response.json().catch(() => null) as GithubTokenResponse | null;
  if (!tokens || typeof tokens !== "object") {
    throw new Error("GitHub OAuth returned an invalid response");
  }
  if (tokens.error) {
    throw new Error(tokens.error_description ?? tokens.error);
  }
  if (typeof tokens.access_token !== "string" || !tokens.access_token.trim()) {
    throw new Error("GitHub OAuth did not return an access token");
  }
  if (tokens.expires_in !== undefined && (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)) {
    throw new Error("GitHub OAuth returned an invalid access-token expiry");
  }
  if (
    tokens.refresh_token_expires_in !== undefined &&
    (!Number.isFinite(tokens.refresh_token_expires_in) || tokens.refresh_token_expires_in <= 0)
  ) {
    throw new Error("GitHub OAuth returned an invalid refresh-token expiry");
  }

  return tokens as ValidGithubTokenResponse;
}

export function getGithubConnectionStatus(
  input: GithubConnectionInput
): GithubConnectionStatus {
  if (
    input.providerKind !== "github_copilot" ||
    !input.githubUserAccessTokenEncrypted
  ) {
    return "disconnected";
  }

  if (!input.githubTokenExpiresAt) {
    return "disconnected";
  }

  if (new Date(input.githubTokenExpiresAt).getTime() < Date.now()) {
    return "expired";
  }

  return "connected";
}

export function shouldRefreshGithubToken(input: GithubRefreshInput): boolean {
  if (!input.githubTokenExpiresAt) {
    return false;
  }

  const expiresAt = new Date(input.githubTokenExpiresAt).getTime();
  return expiresAt - Date.now() < REFRESH_THRESHOLD_MS;
}

export function clearGithubCopilotConnection(
  _input: GithubClearInput
): GithubClearOutput {
  return {
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null
  };
}

export async function createGithubOauthState(
  profileId: string,
  userId: string,
  profileNonce: string
): Promise<string> {
  const secret = new TextEncoder().encode(env.EIDON_SESSION_SECRET);

  return new SignJWT({ profileId, userId, profileNonce, tokenUse: GITHUB_OAUTH_STATE_USE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(GITHUB_OAUTH_STATE_ISSUER)
    .setAudience(GITHUB_OAUTH_STATE_AUDIENCE)
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(secret);
}

export async function verifyGithubOauthState(
  state: string
): Promise<{ profileId: string; userId: string; profileNonce: string }> {
  const secret = new TextEncoder().encode(env.EIDON_SESSION_SECRET);
  const { payload } = await jwtVerify(state, secret, {
    algorithms: ["HS256"],
    issuer: GITHUB_OAUTH_STATE_ISSUER,
    audience: GITHUB_OAUTH_STATE_AUDIENCE
  });

  if (
    payload.tokenUse !== GITHUB_OAUTH_STATE_USE ||
    typeof payload.profileId !== "string" ||
    !payload.profileId.trim() ||
    typeof payload.userId !== "string" ||
    !payload.userId.trim() ||
    typeof payload.profileNonce !== "string" ||
    !payload.profileNonce.trim()
  ) {
    throw new Error("Invalid GitHub OAuth state");
  }

  return {
    profileId: payload.profileId,
    userId: payload.userId,
    profileNonce: payload.profileNonce
  };
}

function createAbortError() {
  const error = new Error("GitHub Copilot operation aborted");
  error.name = "AbortError";
  return error;
}

async function withAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void
): Promise<T> {
  if (!signal) {
    return operation;
  }

  if (signal.aborted) {
    onAbort?.();
    throw createAbortError();
  }

  return await new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      onAbort?.();
      reject(createAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

export function getGithubAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.EIDON_GITHUB_APP_CLIENT_ID!,
    redirect_uri: env.EIDON_GITHUB_APP_CALLBACK_URL!,
    state,
    scope: "read:user"
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGithubCodeForTokens(code: string) {
  const response = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: env.EIDON_GITHUB_APP_CLIENT_ID,
        client_secret: env.EIDON_GITHUB_APP_CLIENT_SECRET,
        code
      })
    }
  );

  return parseGithubTokenResponse(response);
}

export async function refreshGithubUserToken(
  profile: ProviderProfile
): Promise<{
  githubUserAccessTokenEncrypted: string;
  githubRefreshTokenEncrypted: string;
  githubTokenExpiresAt: string;
  githubRefreshTokenExpiresAt: string | null;
}> {
  const refreshToken = decryptValue(profile.githubRefreshTokenEncrypted);
  if (!refreshToken) {
    throw new Error("GitHub Copilot refresh token is missing");
  }

  const response = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: env.EIDON_GITHUB_APP_CLIENT_ID,
        client_secret: env.EIDON_GITHUB_APP_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    }
  );

  const tokens = await parseGithubTokenResponse(response);

  const now = Date.now();

  return {
    githubUserAccessTokenEncrypted: encryptValue(tokens.access_token),
    githubRefreshTokenEncrypted: tokens.refresh_token
      ? encryptValue(tokens.refresh_token)
      : profile.githubRefreshTokenEncrypted,
    githubTokenExpiresAt: new Date(
      now + (tokens.expires_in ?? 28800) * 1000
    ).toISOString(),
    githubRefreshTokenExpiresAt: tokens.refresh_token_expires_in
      ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
      : null
  };
}

export async function ensureFreshGithubAccessToken(
  profile: ProviderProfileWithApiKey,
  abortSignal?: AbortSignal
): Promise<ProviderProfileWithApiKey> {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }

  if (!shouldRefreshGithubToken(profile)) {
    return profile;
  }

  const githubRefreshes = getGithubRefreshes();
  const existingRefresh = githubRefreshes.get(profile.id);
  if (existingRefresh?.refreshTokenVersion === profile.githubRefreshTokenEncrypted) {
    return withAbort(existingRefresh.promise, abortSignal);
  }

  const refresh = (async () => {
    const refreshed = await refreshGithubUserToken(profile);

    const persisted = updateGithubCopilotCredentialsIfRefreshTokenMatches(
      profile.id,
      profile.githubRefreshTokenEncrypted,
      {
      githubUserAccessToken: decryptValue(refreshed.githubUserAccessTokenEncrypted),
      githubRefreshToken: decryptValue(refreshed.githubRefreshTokenEncrypted),
      githubTokenExpiresAt: refreshed.githubTokenExpiresAt,
      githubRefreshTokenExpiresAt: refreshed.githubRefreshTokenExpiresAt,
      githubAccountLogin: profile.githubAccountLogin,
      githubAccountName: profile.githubAccountName
      }
    );
    if (!persisted) {
      throw new Error("GitHub Copilot connection changed during token refresh");
    }

    return {
      ...profile,
      ...refreshed
    };
  })();

  const entry = {
    refreshTokenVersion: profile.githubRefreshTokenEncrypted,
    promise: refresh
  };
  githubRefreshes.set(profile.id, entry);
  const clearRefresh = () => {
    if (githubRefreshes.get(profile.id) === entry) githubRefreshes.delete(profile.id);
  };
  void refresh.then(clearRefresh, clearRefresh);
  return await withAbort(refresh, abortSignal);
}

export async function listGithubCopilotModels(
  profile: ProviderProfileWithApiKey
) {
  const accessToken = decryptValue(
    profile.githubUserAccessTokenEncrypted
  );

  const client = new CopilotClient({
    githubToken: accessToken,
    useLoggedInUser: false
  });

  await client.start();

  try {
    return await client.listModels();
  } finally {
    await client.stop();
  }
}

export async function buildGithubCopilotClient(
  profile: ProviderProfileWithApiKey
) {
  const accessToken = decryptValue(
    profile.githubUserAccessTokenEncrypted
  );

  return new CopilotClient({
    githubToken: accessToken,
    useLoggedInUser: false
  });
}

export async function runGithubCopilotChat(
  input: ProviderProfileWithApiKey & {
    messages: Array<{ role: string; content: string }>;
    abortSignal?: AbortSignal;
  }
) {
  if (input.abortSignal?.aborted) {
    throw createAbortError();
  }
  const client = await buildGithubCopilotClient(input);
  let session: Awaited<ReturnType<typeof client.createSession>> | null = null;

  try {
    session = await withAbort(client.createSession({
      model: input.model,
      onPermissionRequest: () => ({ kind: "approved" as const })
    }), input.abortSignal);

    return await withAbort(session.send({
      prompt: input.messages.map((m) => m.content).join("\n")
    }), input.abortSignal, () => {
      void session?.abort().catch(() => undefined);
    });
  } finally {
    if (input.abortSignal?.aborted) {
      await session?.abort().catch(() => undefined);
    }
    await client.stop();
  }
}

export async function streamGithubCopilotChat(
  input: ProviderProfileWithApiKey & {
    messages: Array<{ role: string; content: string }>;
    onEvent: (event: unknown) => void;
    tools?: Tool[];
    abortSignal?: AbortSignal;
  }
) {
  if (input.abortSignal?.aborted) {
    throw createAbortError();
  }
  const client = await buildGithubCopilotClient(input);
  let session: Awaited<ReturnType<typeof client.createSession>> | null = null;

  try {
    let resolveTurn: () => void;
    let rejectTurn: (error: Error) => void;
    const turnComplete = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });

    const sessionConfig = {
      model: input.model,
      streaming: true as const,
      workingDirectory: ensureCopilotWorkDir(),
      excludedTools: COPILOT_EXCLUDED_TOOLS,
      onPermissionRequest: () => ({ kind: "approved" as const }),
      onEvent: (rawEvent: unknown) => {
        const event = rawEvent as { type: string; data?: Record<string, unknown> };

        input.onEvent(rawEvent);

        if (event.type === "assistant.turn_end" || event.type === "session.idle") {
          resolveTurn();
        } else if (event.type === "session.error" && event.data?.message) {
          rejectTurn(new Error(event.data.message as string));
        }
      },
      ...(input.systemPrompt
        ? { systemMessage: { mode: "replace" as const, content: input.systemPrompt } }
        : {}),
      ...(input.tools?.length ? { tools: input.tools } : {})
    };

    session = await withAbort(client.createSession(sessionConfig), input.abortSignal);

    await withAbort(session.send({
      prompt: input.messages.map((m) => m.content).join("\n")
    }), input.abortSignal, () => {
      void session?.abort().catch(() => undefined);
    });

    await withAbort(turnComplete, input.abortSignal, () => {
      void session?.abort().catch(() => undefined);
    });
  } finally {
    if (input.abortSignal?.aborted) {
      await session?.abort().catch(() => undefined);
    }
    await client.stop();
  }
}

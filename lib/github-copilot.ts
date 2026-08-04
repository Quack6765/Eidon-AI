import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CopilotClient } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";

import { env } from "@/lib/env";
import { getProviderConnectionSummary } from "@/lib/provider-profile";
import {
  updateProviderConnectionIfNonceMatches,
  updateProviderConnectionIfRefreshTokenMatches
} from "@/lib/provider-profiles";
import type { RuntimeProviderProfile } from "@/lib/types";

const COPILOT_WORK_DIR = join(tmpdir(), "eidon-copilot");

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

const REFRESH_THRESHOLD_MS = 2 * 60 * 1000;
const GITHUB_REFRESH_REGISTRY_KEY = Symbol.for("eidon:github-copilot-refreshes");
type GithubRefreshEntry = {
  refreshTokenVersion: string;
  promise: Promise<RuntimeProviderProfile>;
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

export function updateGithubCopilotConnectionIfNonceMatches(
  profileId: string,
  nonce: string,
  input: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string | null;
    refreshExpiresAt: string | null;
    accountLogin: string | null;
    accountName: string | null;
  }
) {
  return updateProviderConnectionIfNonceMatches(profileId, nonce, {
    credentials: {
      accessToken: input.accessToken,
      refreshToken: input.refreshToken
    },
    metadata: {
      expiresAt: input.expiresAt,
      refreshExpiresAt: input.refreshExpiresAt,
      accountLabel: input.accountName ?? input.accountLogin
    }
  });
}

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
  input: RuntimeProviderProfile
) {
  return getProviderConnectionSummary(input).status;
}

export function shouldRefreshGithubToken(input: RuntimeProviderProfile): boolean {
  if (!input.connectionMetadata.expiresAt) {
    return false;
  }

  const expiresAt = new Date(input.connectionMetadata.expiresAt).getTime();
  return expiresAt - Date.now() < REFRESH_THRESHOLD_MS;
}

export function clearGithubCopilotConnection() {
  return {
    credentials: {},
    connectionMetadata: {}
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
  profile: RuntimeProviderProfile
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string | null;
}> {
  const refreshToken = profile.credentials.refreshToken ?? "";
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
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expiresAt: new Date(
      now + (tokens.expires_in ?? 28800) * 1000
    ).toISOString(),
    refreshExpiresAt: tokens.refresh_token_expires_in
      ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
      : null
  };
}

export async function ensureFreshGithubAccessToken(
  profile: RuntimeProviderProfile,
  abortSignal?: AbortSignal
): Promise<RuntimeProviderProfile> {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }

  if (!shouldRefreshGithubToken(profile)) {
    return profile;
  }

  const githubRefreshes = getGithubRefreshes();
  const existingRefresh = githubRefreshes.get(profile.id);
  const refreshToken = profile.credentials.refreshToken ?? "";
  if (existingRefresh?.refreshTokenVersion === refreshToken) {
    return withAbort(existingRefresh.promise, abortSignal);
  }

  const refresh = (async () => {
    const refreshed = await refreshGithubUserToken(profile);

    const persisted = updateProviderConnectionIfRefreshTokenMatches(
      profile.id,
      refreshToken,
      {
        credentials: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken
        },
        metadata: {
          expiresAt: refreshed.expiresAt,
          refreshExpiresAt: refreshed.refreshExpiresAt,
          accountLabel: profile.connectionMetadata.accountLabel
        }
      }
    );
    if (!persisted) {
      throw new Error("GitHub Copilot connection changed during token refresh");
    }

    return {
      ...profile,
      credentials: {
        ...profile.credentials,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken
      },
      connectionMetadata: {
        ...profile.connectionMetadata,
        expiresAt: refreshed.expiresAt,
        refreshExpiresAt: refreshed.refreshExpiresAt
      }
    };
  })();

  const entry = {
    refreshTokenVersion: refreshToken,
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
  profile: RuntimeProviderProfile
) {
  const accessToken = profile.credentials.accessToken ?? "";

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
  profile: RuntimeProviderProfile
) {
  const accessToken = profile.credentials.accessToken ?? "";

  return new CopilotClient({
    githubToken: accessToken,
    useLoggedInUser: false
  });
}

export async function runGithubCopilotChat(
  input: RuntimeProviderProfile & {
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
  input: RuntimeProviderProfile & {
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

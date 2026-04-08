import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SignJWT, jwtVerify } from "jose";
import { CopilotClient } from "@github/copilot-sdk";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { env } from "@/lib/env";
import type {
  GithubConnectionStatus,
  ProviderProfile,
  ProviderProfileWithApiKey
} from "@/lib/types";
import { updateGithubCopilotCredentials } from "@/lib/settings";

const COPILOT_WORK_DIR = join(tmpdir(), "eidon-copilot");

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
  userId: string
): Promise<string> {
  const secret = new TextEncoder().encode(env.EIDON_SESSION_SECRET);

  return new SignJWT({ profileId, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(secret);
}

export async function verifyGithubOauthState(
  state: string
): Promise<{ profileId: string; userId: string }> {
  const secret = new TextEncoder().encode(env.EIDON_SESSION_SECRET);
  const { payload } = await jwtVerify(state, secret);

  return {
    profileId: payload.profileId as string,
    userId: payload.userId as string
  };
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

  return response.json() as Promise<{
    access_token?: string;
    token_type?: string;
    scope?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  }>;
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

  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
  };

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
  profile: ProviderProfileWithApiKey
): Promise<ProviderProfileWithApiKey> {
  if (!shouldRefreshGithubToken(profile)) {
    return profile;
  }

  const refreshed = await refreshGithubUserToken(profile);

  updateGithubCopilotCredentials(profile.id, {
    githubUserAccessToken: decryptValue(refreshed.githubUserAccessTokenEncrypted),
    githubRefreshToken: decryptValue(refreshed.githubRefreshTokenEncrypted),
    githubTokenExpiresAt: refreshed.githubTokenExpiresAt,
    githubRefreshTokenExpiresAt: refreshed.githubRefreshTokenExpiresAt,
    githubAccountLogin: profile.githubAccountLogin,
    githubAccountName: profile.githubAccountName
  });

  return {
    ...profile,
    ...refreshed
  };
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
  }
) {
  const client = await buildGithubCopilotClient(input);

  const session = await client.createSession({
    model: input.model,
    onPermissionRequest: () => ({ kind: "approved" as const })
  });

  const result = await session.send({
    prompt: input.messages.map((m) => m.content).join("\n")
  });

  return result;
}

export async function streamGithubCopilotChat(
  input: ProviderProfileWithApiKey & {
    messages: Array<{ role: string; content: string }>;
    onEvent: (event: unknown) => void;
  }
) {
  const client = await buildGithubCopilotClient(input);

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
      availableTools: [] as string[],
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
        : {})
    };

    const session = await client.createSession(sessionConfig);

    await session.send({
      prompt: input.messages.map((m) => m.content).join("\n")
    });

    await turnComplete;
  } finally {
    await client.stop();
  }
}

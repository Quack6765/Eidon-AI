import { decryptValue, encryptValue } from "@/lib/crypto";

const {
  updateGithubCopilotCredentials,
  copilotClientCtor
} = vi.hoisted(() => ({
  updateGithubCopilotCredentials: vi.fn(),
  copilotClientCtor: vi.fn()
}));

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");

  return {
    ...actual,
    updateGithubCopilotCredentials
  };
});

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: copilotClientCtor
}));

import {
  buildGithubCopilotClient,
  clearGithubCopilotConnection,
  createGithubOauthState,
  ensureFreshGithubAccessToken,
  exchangeGithubCodeForTokens,
  getGithubAuthorizeUrl,
  getGithubConnectionStatus,
  listGithubCopilotModels,
  refreshGithubUserToken,
  runGithubCopilotChat,
  shouldRefreshGithubToken,
  streamGithubCopilotChat,
  verifyGithubOauthState
} from "@/lib/github-copilot";

function createProfile(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();

  return {
    id: "profile_copilot",
    providerKind: "github_copilot" as const,
    name: "Copilot",
    apiBaseUrl: "",
    apiKeyEncrypted: "",
    apiKey: "",
    model: "openai/gpt-4.1",
    apiMode: "responses" as const,
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    reasoningEffort: "medium" as const,
    reasoningSummaryEnabled: true,
    modelContextLimit: 16000,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    tokenizerModel: "gpt-tokenizer" as const,
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    visionMode: "native" as const,
    visionMcpServerId: null,
    githubUserAccessTokenEncrypted: encryptValue("ghu_access"),
    githubRefreshTokenEncrypted: encryptValue("ghr_refresh"),
    githubTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    githubRefreshTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    githubAccountLogin: "octocat",
    githubAccountName: "The Octocat",
    createdAt: now,
    updatedAt: now,
    hasApiKey: false,
    githubConnectionStatus: "connected" as const,
    ...overrides
  };
}

type MockSession = {
  send: ReturnType<typeof vi.fn>;
};

type MockClient = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
};

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue([{ id: "openai/gpt-4.1", name: "GPT-4.1" }]),
    createSession: vi.fn(),
    ...overrides
  };
}

describe("github copilot helpers", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.env.EIDON_GITHUB_APP_CLIENT_ID = "github-client-id";
    process.env.EIDON_GITHUB_APP_CLIENT_SECRET = "github-client-secret";
    process.env.EIDON_GITHUB_APP_CALLBACK_URL =
      "http://localhost/api/providers/github/callback";
    global.fetch = vi.fn();
  });

  it("detects when a token should be refreshed", () => {
    expect(
      shouldRefreshGithubToken({
        githubTokenExpiresAt: new Date(Date.now() + 30_000).toISOString()
      })
    ).toBe(true);

    expect(
      shouldRefreshGithubToken({
        githubTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      })
    ).toBe(false);
  });

  it("does not refresh a github token when no expiry is stored", () => {
    expect(
      shouldRefreshGithubToken({
        githubTokenExpiresAt: null
      })
    ).toBe(false);
  });

  it("computes connection state from stored credentials", () => {
    expect(
      getGithubConnectionStatus({
        providerKind: "github_copilot",
        githubUserAccessTokenEncrypted: "",
        githubTokenExpiresAt: null
      })
    ).toBe("disconnected");

    expect(
      getGithubConnectionStatus({
        providerKind: "github_copilot",
        githubUserAccessTokenEncrypted: encryptValue("ghu_123"),
        githubTokenExpiresAt: new Date(Date.now() + 60_000).toISOString()
      })
    ).toBe("connected");

    expect(
      getGithubConnectionStatus({
        providerKind: "github_copilot",
        githubUserAccessTokenEncrypted: encryptValue("ghu_123"),
        githubTokenExpiresAt: new Date(Date.now() - 60_000).toISOString()
      })
    ).toBe("expired");
  });

  it("treats copilot profiles without an expiry timestamp as disconnected", () => {
    expect(
      getGithubConnectionStatus({
        providerKind: "github_copilot",
        githubUserAccessTokenEncrypted: encryptValue("ghu_123"),
        githubTokenExpiresAt: null
      })
    ).toBe("disconnected");
  });

  it("clears only github oauth fields when disconnecting", () => {
    expect(
      clearGithubCopilotConnection({
        githubUserAccessTokenEncrypted: "ciphertext-access",
        githubRefreshTokenEncrypted: "ciphertext-refresh",
        githubTokenExpiresAt: "2026-04-08T16:00:00.000Z",
        githubRefreshTokenExpiresAt: "2026-10-08T16:00:00.000Z",
        githubAccountLogin: "octocat",
        githubAccountName: "The Octocat"
      })
    ).toEqual({
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAccountName: null
    });
  });

  it("creates and verifies oauth state tokens", async () => {
    const state = await createGithubOauthState("profile_1", "user_1");

    await expect(verifyGithubOauthState(state)).resolves.toEqual({
      profileId: "profile_1",
      userId: "user_1"
    });
  });

  it("builds the github authorize url from env config", () => {
    const url = new URL(getGithubAuthorizeUrl("state-token"));

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("github-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/providers/github/callback"
    );
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("scope")).toBe("read:user");
  });

  it("exchanges an oauth code for tokens", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({ access_token: "ghu_new" })
    } as Response);

    await expect(exchangeGithubCodeForTokens("oauth-code")).resolves.toEqual({
      access_token: "ghu_new"
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_id: "github-client-id",
          client_secret: "github-client-secret",
          code: "oauth-code"
        })
      })
    );
  });

  it("refreshes a github user token and preserves the stored refresh token when omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T10:00:00.000Z"));
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({
        access_token: "ghu_refreshed",
        expires_in: 120
      })
    } as Response);

    const profile = createProfile();

    const refreshed = await refreshGithubUserToken(profile);

    expect(refreshed.githubRefreshTokenEncrypted).toBe(profile.githubRefreshTokenEncrypted);
    expect(decryptValue(refreshed.githubUserAccessTokenEncrypted)).toBe(
      "ghu_refreshed"
    );
    expect(refreshed.githubTokenExpiresAt).toBe("2026-04-09T10:02:00.000Z");
    expect(refreshed.githubRefreshTokenExpiresAt).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_id: "github-client-id",
          client_secret: "github-client-secret",
          grant_type: "refresh_token",
          refresh_token: "ghr_refresh"
        })
      })
    );
  });

  it("returns the same profile when the github token is still fresh", async () => {
    const profile = createProfile({
      githubTokenExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
    });

    await expect(ensureFreshGithubAccessToken(profile)).resolves.toBe(profile);
    expect(updateGithubCopilotCredentials).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes expiring github credentials and persists the new values", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T10:00:00.000Z"));
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({
        access_token: "ghu_refreshed",
        refresh_token: "ghr_rotated",
        expires_in: 300,
        refresh_token_expires_in: 7200
      })
    } as Response);

    const profile = createProfile({
      githubTokenExpiresAt: new Date(Date.now() + 30_000).toISOString()
    });

    const refreshed = await ensureFreshGithubAccessToken(profile);

    expect(decryptValue(refreshed.githubUserAccessTokenEncrypted)).toBe(
      "ghu_refreshed"
    );
    expect(decryptValue(refreshed.githubRefreshTokenEncrypted)).toBe(
      "ghr_rotated"
    );
    expect(refreshed.githubTokenExpiresAt).toBe("2026-04-09T10:05:00.000Z");
    expect(refreshed.githubRefreshTokenExpiresAt).toBe(
      "2026-04-09T12:00:00.000Z"
    );
    expect(updateGithubCopilotCredentials).toHaveBeenCalledWith("profile_copilot", {
      githubUserAccessToken: "ghu_refreshed",
      githubRefreshToken: "ghr_rotated",
      githubTokenExpiresAt: "2026-04-09T10:05:00.000Z",
      githubRefreshTokenExpiresAt: "2026-04-09T12:00:00.000Z",
      githubAccountLogin: "octocat",
      githubAccountName: "The Octocat"
    });
  });

  it("lists github copilot models with a started and stopped client", async () => {
    const client = createMockClient();
    copilotClientCtor.mockImplementation(() => client);

    await expect(listGithubCopilotModels(createProfile())).resolves.toEqual([
      { id: "openai/gpt-4.1", name: "GPT-4.1" }
    ]);

    expect(copilotClientCtor).toHaveBeenCalledWith({
      githubToken: "ghu_access",
      useLoggedInUser: false
    });
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it("builds a github copilot client with the decrypted token", async () => {
    const client = createMockClient();
    copilotClientCtor.mockImplementation(() => client);

    await expect(buildGithubCopilotClient(createProfile())).resolves.toBe(client);
    expect(copilotClientCtor).toHaveBeenCalledWith({
      githubToken: "ghu_access",
      useLoggedInUser: false
    });
  });

  it("runs a copilot chat turn with the joined prompt", async () => {
    const session: MockSession = {
      send: vi.fn().mockResolvedValue({ reply: "done" })
    };
    const client = createMockClient({
      createSession: vi.fn().mockResolvedValue(session)
    });
    copilotClientCtor.mockImplementation(() => client);

    await expect(
      runGithubCopilotChat({
        ...createProfile(),
        messages: [
          { role: "user", content: "First line" },
          { role: "assistant", content: "Second line" }
        ]
      })
    ).resolves.toEqual({ reply: "done" });

    expect(client.createSession).toHaveBeenCalledWith({
      model: "openai/gpt-4.1",
      onPermissionRequest: expect.any(Function)
    });
    const onPermissionRequest = client.createSession.mock.calls[0]?.[0]?.onPermissionRequest;
    expect(onPermissionRequest()).toEqual({ kind: "approved" });
    expect(session.send).toHaveBeenCalledWith({
      prompt: "First line\nSecond line"
    });
  });

  it("streams a copilot chat turn until the assistant finishes", async () => {
    const events: unknown[] = [];
    const session: MockSession = {
      send: vi.fn().mockResolvedValue(undefined)
    };
    const client = createMockClient({
      createSession: vi.fn().mockImplementation(async (config: Record<string, unknown>) => {
        const onEvent = config.onEvent as (event: unknown) => void;
        queueMicrotask(() => onEvent({ type: "assistant.turn_end" }));
        return session;
      })
    });
    copilotClientCtor.mockImplementation(() => client);

    await expect(
      streamGithubCopilotChat({
        ...createProfile(),
        messages: [{ role: "user", content: "Ship it" }],
        onEvent: (event) => events.push(event)
      })
    ).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4.1",
        streaming: true,
        availableTools: [],
        systemMessage: { mode: "replace", content: "Be exact." },
        onPermissionRequest: expect.any(Function),
        onEvent: expect.any(Function),
        workingDirectory: expect.stringContaining("eidon-copilot")
      })
    );
    expect(session.send).toHaveBeenCalledWith({
      prompt: "Ship it"
    });
    expect(events).toEqual([{ type: "assistant.turn_end" }]);
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it("rejects a streaming copilot chat turn when the session reports an error", async () => {
    const session: MockSession = {
      send: vi.fn().mockResolvedValue(undefined)
    };
    const client = createMockClient({
      createSession: vi.fn().mockImplementation(async (config: Record<string, unknown>) => {
        const onEvent = config.onEvent as (event: unknown) => void;
        queueMicrotask(() =>
          onEvent({
            type: "session.error",
            data: { message: "stream failed" }
          })
        );
        return session;
      })
    });
    copilotClientCtor.mockImplementation(() => client);

    await expect(
      streamGithubCopilotChat({
        ...createProfile(),
        messages: [{ role: "user", content: "Ship it" }],
        onEvent: vi.fn()
      })
    ).rejects.toThrow("stream failed");

    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it("streams without a system prompt and resolves when the session goes idle", async () => {
    const session: MockSession = {
      send: vi.fn().mockResolvedValue(undefined)
    };
    const client = createMockClient({
      createSession: vi.fn().mockImplementation(async (config: Record<string, unknown>) => {
        const onEvent = config.onEvent as (event: unknown) => void;
        queueMicrotask(() => onEvent({ type: "session.idle" }));
        return session;
      })
    });
    copilotClientCtor.mockImplementation(() => client);

    await expect(
      streamGithubCopilotChat({
        ...createProfile({ systemPrompt: "" }),
        messages: [{ role: "user", content: "Ship it" }],
        onEvent: vi.fn()
      })
    ).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.not.objectContaining({
        systemMessage: expect.anything()
      })
    );
    expect(client.stop).toHaveBeenCalledTimes(1);
  });
});

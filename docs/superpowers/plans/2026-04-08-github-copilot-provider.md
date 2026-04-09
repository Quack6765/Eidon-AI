# GitHub Copilot Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-profile GitHub Copilot provider that connects through GitHub OAuth, lazily refreshes tokens on the server, exposes account-scoped models in settings, and lets Eidon chat through the user's own Copilot subscription.

**Architecture:** Extend the existing `provider_profiles` record to support a `providerKind` discriminator plus GitHub OAuth credential metadata, then add a dedicated `lib/github-copilot.ts` module that owns OAuth, lazy refresh, and model discovery. Keep the existing OpenAI-compatible path intact and branch at runtime in `lib/provider.ts` and the settings UI.

**Tech Stack:** Next.js App Router route handlers, React 19, better-sqlite3, zod, Vitest, Testing Library, `@github/copilot-sdk`

---

### Task 1: Add GitHub Copilot dependency and environment plumbing

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `lib/env.ts`
- Test: `tests/unit/env.test.ts`

- [ ] **Step 1: Write the failing environment test**

Add this test block to `tests/unit/env.test.ts`:

```ts
  it("reads GitHub Copilot OAuth environment variables when provided", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      EIDON_ADMIN_PASSWORD: "production-admin-password-32-chars",
      EIDON_SESSION_SECRET: "production-session-secret-with-32-chars",
      EIDON_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
      EIDON_GITHUB_APP_CLIENT_ID: "Iv23exampleclientid",
      EIDON_GITHUB_APP_CLIENT_SECRET: "github-app-client-secret-value",
      EIDON_GITHUB_APP_CALLBACK_URL: "https://eidon.example.com/api/providers/github/callback"
    });

    expect(env.EIDON_GITHUB_APP_CLIENT_ID).toBe("Iv23exampleclientid");
    expect(env.EIDON_GITHUB_APP_CLIENT_SECRET).toBe("github-app-client-secret-value");
    expect(env.EIDON_GITHUB_APP_CALLBACK_URL).toBe(
      "https://eidon.example.com/api/providers/github/callback"
    );
  });
```

- [ ] **Step 2: Run the env test to verify it fails**

Run:

```bash
npm run test -- tests/unit/env.test.ts
```

Expected: FAIL with `EIDON_GITHUB_APP_CLIENT_ID` or the other GitHub env keys missing from the parsed env object.

- [ ] **Step 3: Add the dependency and env parsing support**

Install the Copilot SDK and keep the resolved version that `npm` writes into `package.json` and `package-lock.json`:

```bash
npm install @github/copilot-sdk
```

Extend `lib/env.ts` in both the schema and the proxy return type with:

```ts
  EIDON_GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
  EIDON_GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
  EIDON_GITHUB_APP_CALLBACK_URL: z.string().url().optional(),
```

No new production secret-default logic is required for these values because the provider is optional and should be unavailable when unset.

- [ ] **Step 4: Install dependencies and update the lockfile**

Run:

```bash
npm install
```

Expected: `package-lock.json` updates and `@github/copilot-sdk` appears in the dependency tree.

- [ ] **Step 5: Run the env test to verify it passes**

Run:

```bash
npm run test -- tests/unit/env.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/env.ts tests/unit/env.test.ts
git commit -m "feat: add copilot oauth env support"
```

---

### Task 2: Extend provider profile storage for Copilot profiles

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/db.ts`
- Modify: `lib/settings.ts`
- Test: `tests/unit/settings.test.ts`

- [ ] **Step 1: Write the failing settings tests**

Add these tests to `tests/unit/settings.test.ts`:

```ts
  it("stores github copilot profiles without requiring an api key", () => {
    const copilot = {
      ...buildProfile({
        id: "profile_copilot",
        name: "Copilot"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAccountName: null
    };

    updateSettings({
      defaultProviderProfileId: copilot.id,
      skillsEnabled: true,
      providerProfiles: [copilot]
    });

    const stored = getProviderProfile(copilot.id);

    expect(stored?.providerKind).toBe("github_copilot");
    expect(stored?.apiKeyEncrypted).toBe("");
  });

  it("keeps duplicated copilot profiles disconnected", () => {
    const connected = {
      ...buildProfile({
        id: "profile_copilot",
        name: "Copilot"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "ciphertext-access",
      githubRefreshTokenEncrypted: "ciphertext-refresh",
      githubTokenExpiresAt: "2026-04-08T16:00:00.000Z",
      githubRefreshTokenExpiresAt: "2026-10-08T16:00:00.000Z",
      githubAccountLogin: "octocat",
      githubAccountName: "The Octocat"
    };

    const duplicate = {
      ...connected,
      id: "profile_copilot_copy",
      name: "Copilot Copy",
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAccountName: null
    };

    updateSettings({
      defaultProviderProfileId: connected.id,
      skillsEnabled: true,
      providerProfiles: [connected, duplicate]
    });

    expect(getProviderProfile("profile_copilot_copy")).toMatchObject({
      providerKind: "github_copilot",
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubAccountLogin: null
    });
  });

  it("does not expose github oauth credentials in sanitized settings", () => {
    const copilot = {
      ...buildProfile({
        id: "profile_copilot",
        name: "Copilot"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "ciphertext-access",
      githubRefreshTokenEncrypted: "ciphertext-refresh",
      githubTokenExpiresAt: "2026-04-08T16:00:00.000Z",
      githubRefreshTokenExpiresAt: "2026-10-08T16:00:00.000Z",
      githubAccountLogin: "octocat",
      githubAccountName: "The Octocat"
    };

    updateSettings({
      defaultProviderProfileId: copilot.id,
      skillsEnabled: true,
      providerProfiles: [copilot]
    });

    const settings = getSanitizedSettings();
    const profile = settings.providerProfiles.find((entry) => entry.id === copilot.id);

    expect(profile).toMatchObject({
      id: "profile_copilot",
      providerKind: "github_copilot",
      githubAccountLogin: "octocat",
      githubConnectionStatus: "connected"
    });
    expect("githubUserAccessTokenEncrypted" in (profile ?? {})).toBe(false);
    expect("githubRefreshTokenEncrypted" in (profile ?? {})).toBe(false);
  });
```

- [ ] **Step 2: Run the settings test file to verify it fails**

Run:

```bash
npm run test -- tests/unit/settings.test.ts
```

Expected: FAIL because `providerKind` and the GitHub credential fields are not part of the types, schema, or database row mapping yet.

- [ ] **Step 3: Add the new provider fields to the shared types**

Update `lib/types.ts` with these additions:

```ts
export type ProviderKind = "openai_compatible" | "github_copilot";

export type GithubConnectionStatus = "disconnected" | "connected" | "expired";

export type ProviderProfile = {
  id: string;
  providerKind: ProviderKind;
  name: string;
  apiBaseUrl: string;
  apiKeyEncrypted: string;
  model: string;
  apiMode: ApiMode;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  compactionThreshold: number;
  freshTailCount: number;
  tokenizerModel: "gpt-tokenizer" | "off";
  safetyMarginTokens: number;
  leafSourceTokenLimit: number;
  leafMinMessageCount: number;
  mergedMinNodeCount: number;
  mergedTargetTokens: number;
  visionMode: VisionMode;
  visionMcpServerId: string | null;
  githubUserAccessTokenEncrypted: string;
  githubRefreshTokenEncrypted: string;
  githubTokenExpiresAt: string | null;
  githubRefreshTokenExpiresAt: string | null;
  githubAccountLogin: string | null;
  githubAccountName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderProfileSummary = Omit<
  ProviderProfile,
  "apiKeyEncrypted" | "githubUserAccessTokenEncrypted" | "githubRefreshTokenEncrypted"
> & {
  hasApiKey: boolean;
  githubConnectionStatus: GithubConnectionStatus;
};
```

- [ ] **Step 4: Add the migration and row mapping**

Extend `provider_profiles` in `lib/db.ts` with these columns:

```sql
      provider_kind TEXT NOT NULL DEFAULT 'openai_compatible',
      vision_mode TEXT DEFAULT 'native',
      vision_mcp_server_id TEXT,
      github_user_access_token_encrypted TEXT NOT NULL DEFAULT '',
      github_refresh_token_encrypted TEXT NOT NULL DEFAULT '',
      github_token_expires_at TEXT,
      github_refresh_token_expires_at TEXT,
      github_account_login TEXT,
      github_account_name TEXT,
```

Add `ALTER TABLE` guards after the main `CREATE TABLE` block so existing databases are upgraded:

```ts
  const providerColumns = db
    .prepare("PRAGMA table_info(provider_profiles)")
    .all() as Array<{ name: string }>;

  const providerColumnNames = new Set(providerColumns.map((column) => column.name));

  if (!providerColumnNames.has("provider_kind")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'openai_compatible'");
  }

  if (!providerColumnNames.has("github_user_access_token_encrypted")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN github_user_access_token_encrypted TEXT NOT NULL DEFAULT ''");
  }

  if (!providerColumnNames.has("github_refresh_token_encrypted")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN github_refresh_token_encrypted TEXT NOT NULL DEFAULT ''");
  }

  if (!providerColumnNames.has("github_token_expires_at")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN github_token_expires_at TEXT");
  }

  if (!providerColumnNames.has("github_refresh_token_expires_at")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN github_refresh_token_expires_at TEXT");
  }

  if (!providerColumnNames.has("github_account_login")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN github_account_login TEXT");
  }

  if (!providerColumnNames.has("github_account_name")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN github_account_name TEXT");
  }
```

- [ ] **Step 5: Update settings validation and sanitization**

In `lib/settings.ts`, extend the runtime schemas and row mapping:

```ts
const runtimeSettingsSchema = z.object({
  providerKind: z.enum(["openai_compatible", "github_copilot"]).default("openai_compatible"),
  apiBaseUrl: z.string().default(""),
  apiKey: z.string().optional().default(""),
  model: z.string().min(1),
  apiMode: z.enum(["responses", "chat_completions"]),
  systemPrompt: z.string().min(1),
  temperature: z.coerce.number().min(0).max(2),
  maxOutputTokens: z.coerce.number().int().min(128).max(32768),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
  reasoningSummaryEnabled: z.coerce.boolean(),
  modelContextLimit: z.coerce.number().int().min(4096).max(2_000_000),
  compactionThreshold: z.coerce.number().min(0.5).max(0.95),
  freshTailCount: z.coerce.number().int().min(8).max(128),
  tokenizerModel: z.enum(["gpt-tokenizer", "off"]).default("gpt-tokenizer"),
  safetyMarginTokens: z.coerce.number().int().min(128).max(32768).default(1200),
  leafSourceTokenLimit: z.coerce.number().int().min(1000).max(100000).default(12000),
  leafMinMessageCount: z.coerce.number().int().min(2).max(50).default(6),
  mergedMinNodeCount: z.coerce.number().int().min(2).max(20).default(4),
  mergedTargetTokens: z.coerce.number().int().min(128).max(16000).default(1600),
  visionMode: z.enum(["none", "native", "mcp"]).default("native"),
  visionMcpServerId: z.string().nullable().default(null),
  githubAccountLogin: z.string().nullable().default(null),
  githubAccountName: z.string().nullable().default(null),
  githubTokenExpiresAt: z.string().nullable().default(null),
  githubRefreshTokenExpiresAt: z.string().nullable().default(null)
}).superRefine((value, context) => {
  if (value.providerKind === "openai_compatible" && !value.apiBaseUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "API base URL is required for OpenAI-compatible profiles",
      path: ["apiBaseUrl"]
    });
  }
});
```

In `getSanitizedSettings()`, compute connection status without exposing encrypted token fields:

```ts
      githubConnectionStatus:
        profile.providerKind !== "github_copilot"
          ? "disconnected"
          : profile.githubUserAccessTokenEncrypted
            ? "connected"
            : "disconnected"
```

- [ ] **Step 6: Run the settings tests to verify they pass**

Run:

```bash
npm run test -- tests/unit/settings.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/db.ts lib/settings.ts tests/unit/settings.test.ts
git commit -m "feat: persist github copilot provider profiles"
```

---

### Task 3: Implement GitHub OAuth, lazy refresh, and model discovery helpers

**Files:**
- Create: `lib/github-copilot.ts`
- Create: `tests/unit/github-copilot.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `tests/unit/github-copilot.test.ts` with:

```ts
import { encryptValue } from "@/lib/crypto";
import {
  clearGithubCopilotConnection,
  getGithubConnectionStatus,
  shouldRefreshGithubToken
} from "@/lib/github-copilot";

describe("github copilot helpers", () => {
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
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
npm run test -- tests/unit/github-copilot.test.ts
```

Expected: FAIL because `lib/github-copilot.ts` does not exist yet.

- [ ] **Step 3: Create the helper module**

Create `lib/github-copilot.ts` with the foundational helpers and exported interfaces:

```ts
import { SignJWT, jwtVerify } from "jose";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { GithubConnectionStatus, ProviderProfile, ProviderProfileWithApiKey } from "@/lib/types";

const GITHUB_STATE_TTL_SECONDS = 10 * 60;
const GITHUB_REFRESH_WINDOW_MS = 2 * 60 * 1000;

export function getGithubConnectionStatus(input: {
  providerKind: ProviderProfile["providerKind"];
  githubUserAccessTokenEncrypted: string;
  githubTokenExpiresAt: string | null;
}): GithubConnectionStatus {
  if (input.providerKind !== "github_copilot" || !input.githubUserAccessTokenEncrypted) {
    return "disconnected";
  }

  if (input.githubTokenExpiresAt && Date.parse(input.githubTokenExpiresAt) <= Date.now()) {
    return "expired";
  }

  return "connected";
}

export function shouldRefreshGithubToken(input: {
  githubTokenExpiresAt: string | null;
}) {
  if (!input.githubTokenExpiresAt) {
    return false;
  }

  return Date.parse(input.githubTokenExpiresAt) - Date.now() <= GITHUB_REFRESH_WINDOW_MS;
}

export function clearGithubCopilotConnection(_input: {
  githubUserAccessTokenEncrypted: string;
  githubRefreshTokenEncrypted: string;
  githubTokenExpiresAt: string | null;
  githubRefreshTokenExpiresAt: string | null;
  githubAccountLogin: string | null;
  githubAccountName: string | null;
}) {
  return {
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null
  };
}
```

Then continue the same file with:
- `createGithubOauthState(profileId: string, userId: string)`
- `verifyGithubOauthState(state: string)`
- `exchangeGithubCodeForTokens(code: string)`
- `refreshGithubUserToken(profile: ProviderProfileWithApiKey)`
- `listGithubCopilotModels(profile: ProviderProfileWithApiKey)`
- `buildGithubCopilotClient(profile: ProviderProfileWithApiKey)`

Use server-only fetch and encrypt newly returned tokens before persistence boundaries.

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
npm run test -- tests/unit/github-copilot.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/github-copilot.ts tests/unit/github-copilot.test.ts
git commit -m "feat: add github copilot oauth helpers"
```

---

### Task 4: Add profile-scoped GitHub OAuth routes and persistence hooks

**Files:**
- Create: `app/api/providers/github/connect/route.ts`
- Create: `app/api/providers/github/callback/route.ts`
- Create: `app/api/providers/github/disconnect/route.ts`
- Create: `app/api/providers/github/models/route.ts`
- Modify: `lib/settings.ts`
- Test: `tests/unit/github-copilot-routes.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `tests/unit/github-copilot-routes.test.ts` with:

```ts
import { GET as connect } from "@/app/api/providers/github/connect/route";
import { GET as callback } from "@/app/api/providers/github/callback/route";
import { POST as disconnect } from "@/app/api/providers/github/disconnect/route";
import { GET as models } from "@/app/api/providers/github/models/route";

describe("github copilot routes", () => {
  it("rejects connect requests for non-copilot profiles", async () => {
    const response = await connect(
      new Request("http://localhost/api/providers/github/connect?providerProfileId=missing")
    );

    expect(response.status).toBe(400);
  });

  it("rejects callback requests with an invalid state token", async () => {
    const response = await callback(
      new Request(
        "http://localhost/api/providers/github/callback?code=test-code&state=invalid-state"
      )
    );

    expect(response.status).toBe(400);
  });

  it("clears oauth credentials on disconnect", async () => {
    const response = await disconnect(
      new Request("http://localhost/api/providers/github/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerProfileId: "profile_copilot" })
      })
    );

    expect(response.status).toBe(200);
  });

  it("rejects model discovery for disconnected profiles", async () => {
    const response = await models(
      new Request("http://localhost/api/providers/github/models?providerProfileId=profile_copilot")
    );

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
npm run test -- tests/unit/github-copilot-routes.test.ts
```

Expected: FAIL because the route files do not exist yet.

- [ ] **Step 3: Add persistence helpers to settings**

Add these functions to `lib/settings.ts` before the exported settings readers:

```ts
export function updateGithubCopilotCredentials(
  profileId: string,
  input: {
    githubUserAccessToken: string;
    githubRefreshToken: string;
    githubTokenExpiresAt: string | null;
    githubRefreshTokenExpiresAt: string | null;
    githubAccountLogin: string | null;
    githubAccountName: string | null;
  }
) {
  const timestamp = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE provider_profiles
       SET github_user_access_token_encrypted = ?,
           github_refresh_token_encrypted = ?,
           github_token_expires_at = ?,
           github_refresh_token_expires_at = ?,
           github_account_login = ?,
           github_account_name = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.githubUserAccessToken ? encryptValue(input.githubUserAccessToken) : "",
      input.githubRefreshToken ? encryptValue(input.githubRefreshToken) : "",
      input.githubTokenExpiresAt,
      input.githubRefreshTokenExpiresAt,
      input.githubAccountLogin,
      input.githubAccountName,
      timestamp,
      profileId
    );
}

export function clearGithubCopilotCredentials(profileId: string) {
  const timestamp = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE provider_profiles
       SET github_user_access_token_encrypted = '',
           github_refresh_token_encrypted = '',
           github_token_expires_at = NULL,
           github_refresh_token_expires_at = NULL,
           github_account_login = NULL,
           github_account_name = NULL,
           updated_at = ?
       WHERE id = ?`
    )
    .run(timestamp, profileId);
}
```

- [ ] **Step 4: Create the route handlers**

Implement the connect route around `requireUser()`, `getProviderProfile()`, and `createGithubOauthState()`:

```ts
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { badRequest } from "@/lib/http";
import { createGithubOauthState, getGithubAuthorizeUrl } from "@/lib/github-copilot";
import { getProviderProfile } from "@/lib/settings";

export async function GET(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const providerProfileId = url.searchParams.get("providerProfileId");

  if (!providerProfileId) {
    return badRequest("Provider profile is required");
  }

  const profile = getProviderProfile(providerProfileId);

  if (!profile || profile.providerKind !== "github_copilot") {
    return badRequest("GitHub Copilot is only available for Copilot profiles");
  }

  const state = await createGithubOauthState(profile.id, user.id);
  redirect(getGithubAuthorizeUrl(state));
}
```

Implement the callback, disconnect, and models routes with the same guard pattern:
- validate `state`
- exchange code
- persist encrypted credentials
- lazily refresh before listing models
- reject missing or disconnected profiles with `badRequest(...)`

- [ ] **Step 5: Run the route tests to verify they pass**

Run:

```bash
npm run test -- tests/unit/github-copilot-routes.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/providers/github/connect/route.ts app/api/providers/github/callback/route.ts app/api/providers/github/disconnect/route.ts app/api/providers/github/models/route.ts lib/settings.ts tests/unit/github-copilot-routes.test.ts
git commit -m "feat: add github copilot oauth routes"
```

---

### Task 5: Add Copilot runtime branching and connection testing

**Files:**
- Modify: `lib/provider.ts`
- Modify: `app/api/settings/test/route.ts`
- Modify: `tests/unit/provider.test.ts`

- [ ] **Step 1: Write the failing provider tests**

Add these tests to `tests/unit/provider.test.ts`:

```ts
  it("routes github copilot profiles through the copilot client", async () => {
    const runGithubCopilotChat = vi.fn().mockResolvedValue("connected");

    vi.doMock("@/lib/github-copilot", () => ({
      runGithubCopilotChat,
      ensureFreshGithubAccessToken: vi.fn(async (profile) => profile)
    }));

    const { callProviderText } = await import("@/lib/provider");

    await expect(
      callProviderText({
        settings: createSettings({
          providerKind: "github_copilot",
          apiKey: "",
          apiBaseUrl: ""
        }) as any,
        prompt: "Reply with connected",
        purpose: "test"
      })
    ).resolves.toBe("connected");

    expect(runGithubCopilotChat).toHaveBeenCalledOnce();
    expect(chatCreate).not.toHaveBeenCalled();
    expect(responsesCreate).not.toHaveBeenCalled();
  });
```

Also add a connection-test route assertion in a new block or existing route test file to verify disconnected Copilot profiles return an explicit error message rather than `Set an API key before running a connection test`.

- [ ] **Step 2: Run the provider test file to verify it fails**

Run:

```bash
npm run test -- tests/unit/provider.test.ts
```

Expected: FAIL because `callProviderText()` currently assumes every provider is OpenAI-compatible.

- [ ] **Step 3: Branch by provider kind in lib/provider.ts**

At the top of `lib/provider.ts`, add the new import:

```ts
import { ensureFreshGithubAccessToken, runGithubCopilotChat, streamGithubCopilotChat } from "@/lib/github-copilot";
```

Then short-circuit both text and stream entry points:

```ts
  if (settings.providerKind === "github_copilot") {
    const freshSettings = await ensureFreshGithubAccessToken(settings);
    return runGithubCopilotChat({
      settings: freshSettings,
      prompt: input.prompt,
      purpose: input.purpose,
      conversationId: input.conversationId
    });
  }
```

And in the stream function:

```ts
  if (settings.providerKind === "github_copilot") {
    return streamGithubCopilotChat({
      settings: await ensureFreshGithubAccessToken(settings),
      promptMessages: input.promptMessages,
      tools: input.tools
    });
  }
```

- [ ] **Step 4: Update the settings connection-test route**

Change `app/api/settings/test/route.ts` to branch on `providerKind`:

```ts
    if (!settings) {
      return badRequest("Provider profile not found");
    }

    if (settings.providerKind === "openai_compatible" && !settings.apiKey) {
      return badRequest("Set an API key before running a connection test");
    }

    if (
      settings.providerKind === "github_copilot" &&
      !settings.githubUserAccessTokenEncrypted
    ) {
      return badRequest("Connect a GitHub account before running a Copilot connection test");
    }
```

Leave the actual test call using `callProviderText(...)` so both provider kinds share the same top-level runtime entry point.

- [ ] **Step 5: Run the provider tests to verify they pass**

Run:

```bash
npm run test -- tests/unit/provider.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/provider.ts app/api/settings/test/route.ts tests/unit/provider.test.ts
git commit -m "feat: add github copilot runtime path"
```

---

### Task 6: Update the providers settings UI for Copilot profiles

**Files:**
- Modify: `components/settings/sections/providers-section.tsx`
- Create: `tests/unit/providers-section.test.tsx`
- Modify: `lib/provider-presets.ts`

- [ ] **Step 1: Write the failing UI test**

Create `tests/unit/providers-section.test.tsx` with:

```tsx
// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProvidersSection } from "@/components/settings/sections/providers-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

describe("providers section", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [], models: [] })
    } as Response);
  });

  it("shows github connection controls for copilot profiles", async () => {
    render(
      React.createElement(ProvidersSection, {
        settings: {
          defaultProviderProfileId: "profile_copilot",
          skillsEnabled: true,
          providerProfiles: [
            {
              id: "profile_copilot",
              providerKind: "github_copilot",
              name: "Copilot",
              apiBaseUrl: "",
              model: "openai/gpt-4.1",
              apiMode: "responses",
              systemPrompt: "Be exact.",
              temperature: 0.2,
              maxOutputTokens: 512,
              reasoningEffort: "medium",
              reasoningSummaryEnabled: true,
              modelContextLimit: 16000,
              compactionThreshold: 0.8,
              freshTailCount: 12,
              tokenizerModel: "gpt-tokenizer",
              safetyMarginTokens: 1200,
              leafSourceTokenLimit: 12000,
              leafMinMessageCount: 6,
              mergedMinNodeCount: 4,
              mergedTargetTokens: 1600,
              visionMode: "native",
              visionMcpServerId: null,
              githubAccountLogin: null,
              githubAccountName: null,
              githubTokenExpiresAt: null,
              githubRefreshTokenExpiresAt: null,
              githubConnectionStatus: "disconnected",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hasApiKey: false
            }
          ],
          updatedAt: new Date().toISOString()
        }
      })
    );

    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  it("shows fetched github models for a connected copilot profile", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [],
        models: [{ id: "openai/gpt-4.1", name: "GPT-4.1" }]
      })
    } as Response);

    render(
      React.createElement(ProvidersSection, {
        settings: {
          defaultProviderProfileId: "profile_copilot",
          skillsEnabled: true,
          providerProfiles: [
            {
              id: "profile_copilot",
              providerKind: "github_copilot",
              name: "Copilot",
              apiBaseUrl: "",
              model: "openai/gpt-4.1",
              apiMode: "responses",
              systemPrompt: "Be exact.",
              temperature: 0.2,
              maxOutputTokens: 512,
              reasoningEffort: "medium",
              reasoningSummaryEnabled: true,
              modelContextLimit: 16000,
              compactionThreshold: 0.8,
              freshTailCount: 12,
              tokenizerModel: "gpt-tokenizer",
              safetyMarginTokens: 1200,
              leafSourceTokenLimit: 12000,
              leafMinMessageCount: 6,
              mergedMinNodeCount: 4,
              mergedTargetTokens: 1600,
              visionMode: "native",
              visionMcpServerId: null,
              githubAccountLogin: "octocat",
              githubAccountName: "The Octocat",
              githubTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
              githubRefreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
              githubConnectionStatus: "connected",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hasApiKey: false
            }
          ],
          updatedAt: new Date().toISOString()
        }
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GPT-4.1" })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run:

```bash
npm run test -- tests/unit/providers-section.test.tsx
```

Expected: FAIL because the component does not recognize `providerKind` or render Copilot-specific controls.

- [ ] **Step 3: Make provider presets provider-kind aware**

In `lib/provider-presets.ts`, constrain presets to OpenAI-compatible profiles:

```ts
type PresetCompatibleProfile = {
  providerKind: "openai_compatible";
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: ApiMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
};
```

Then guard the matching and apply paths:

```ts
  if (profile.providerKind !== "openai_compatible") {
    return null;
  }
```

- [ ] **Step 4: Add the Copilot form mode**

In `components/settings/sections/providers-section.tsx`, extend the payload and draft types with:

```ts
    providerKind: "openai_compatible" | "github_copilot";
    githubAccountLogin: string | null;
    githubAccountName: string | null;
    githubTokenExpiresAt: string | null;
    githubRefreshTokenExpiresAt: string | null;
    githubConnectionStatus: "disconnected" | "connected" | "expired";
```

Then render the mode-specific UI:

```tsx
                  <label className={labelClass}>Provider type</label>
                  <select
                    className={selectClass}
                    value={activeProviderProfile.providerKind}
                    onChange={(event) =>
                      updateActiveProviderProfile({
                        providerKind: event.target.value as ProviderProfileDraft["providerKind"],
                        apiBaseUrl:
                          event.target.value === "github_copilot"
                            ? ""
                            : activeProviderProfile.apiBaseUrl,
                        apiKey:
                          event.target.value === "github_copilot"
                            ? ""
                            : activeProviderProfile.apiKey
                      })
                    }
                  >
                    <option value="openai_compatible">OpenAI compatible</option>
                    <option value="github_copilot">GitHub Copilot</option>
                  </select>
```

For the Copilot branch, render:

```tsx
                  <div className="space-y-3">
                    <p className={labelClass}>GitHub connection</p>
                    <div className="rounded-xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm text-[#f4f4f5]">
                      {activeProviderProfile.githubConnectionStatus === "connected"
                        ? `Connected as ${activeProviderProfile.githubAccountLogin ?? "GitHub user"}`
                        : "No GitHub account connected"}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" onClick={() => startGithubConnect(activeProviderProfile.id)}>
                        {activeProviderProfile.githubConnectionStatus === "connected"
                          ? "Reconnect GitHub"
                          : "Connect GitHub"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => disconnectGithub(activeProviderProfile.id)}
                        disabled={activeProviderProfile.githubConnectionStatus === "disconnected"}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
```

When a Copilot profile is connected, fetch `/api/providers/github/models?providerProfileId=<id>` in an effect keyed by the selected profile ID and populate the model `<select>` from the returned `models` array.

When duplicating profiles in `addProviderProfile()`, clear all GitHub connection metadata on the cloned draft.

- [ ] **Step 5: Run the UI test to verify it passes**

Run:

```bash
npm run test -- tests/unit/providers-section.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/provider-presets.ts components/settings/sections/providers-section.tsx tests/unit/providers-section.test.tsx
git commit -m "feat: add github copilot provider settings ui"
```

---

### Task 7: Verify the feature end-to-end and update project memory

**Files:**
- Modify: `agent-memory/infrastructure/config.md`
- Modify: `agent-memory/integrations/external.md`

- [ ] **Step 1: Update the memory files**

Append the new config to `agent-memory/infrastructure/config.md`:

```md
| `EIDON_GITHUB_APP_CLIENT_ID` | GitHub App OAuth client ID for Copilot provider connections | No |
| `EIDON_GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth client secret for Copilot provider connections | No |
| `EIDON_GITHUB_APP_CALLBACK_URL` | Absolute callback URL for GitHub Copilot OAuth | No |
```

Append the integration notes to `agent-memory/integrations/external.md`:

```md
## GitHub Copilot
- **Purpose:** Per-profile LLM provider using each user's own GitHub Copilot subscription
- **Auth:** GitHub App OAuth stored per provider profile with encrypted access and refresh tokens
- **Usage:** Settings-level profile connection, account-scoped model discovery, and chat inference through `lib/github-copilot.ts`
- **Token Management:** Server-side lazy refresh before model discovery and chat execution; no background refresh job
```

- [ ] **Step 2: Run the focused test suite**

Run:

```bash
npm run test -- tests/unit/env.test.ts tests/unit/settings.test.ts tests/unit/github-copilot.test.ts tests/unit/github-copilot-routes.test.ts tests/unit/provider.test.ts tests/unit/providers-section.test.tsx
```

Expected: PASS

- [ ] **Step 3: Run lint and typecheck**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: both commands exit successfully with no new errors.

- [ ] **Step 4: Commit**

```bash
git add agent-memory/infrastructure/config.md agent-memory/integrations/external.md
git commit -m "docs: record github copilot provider integration"
```

# Web Search Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a General settings web search selector with `Exa`, `Tavily`, `SearXNG`, and `Disabled`, persist the related per-user configuration, keep those search providers hidden from the MCP settings UI, and inject the selected provider dynamically into chat runtime.

**Architecture:** Extend `user_settings` with search engine selection plus Exa/Tavily secrets and SearXNG base URL. Keep Exa and Tavily as synthetic remote MCP servers injected at runtime, and implement SearXNG as a built-in direct HTTP search tool wired into `assistant-runtime` alongside MCP tools. The General settings page remains the only user-facing control surface for this feature.

**Tech Stack:** Next.js 15, React 19, TypeScript, better-sqlite3, Vitest, Testing Library, Playwright, agent-browser

---

## File Structure

- `lib/types.ts`
  Add `WebSearchEngine` and extend `AppSettings` with search fields.
- `lib/db.ts`
  Add `user_settings` columns and migrations for search settings.
- `lib/settings.ts`
  Read, sanitize, encrypt, decrypt, default, and update search settings per user.
- `app/api/settings/general/route.ts`
  Accept and validate the new general settings fields.
- `components/settings/sections/general-section.tsx`
  Render the new `Web Search` controls, conditional inputs, inline validation, and save payload.
- `lib/web-search.ts`
  New helper that derives the active built-in search provider from `AppSettings`.
- `lib/searxng.ts`
  New helper that executes a SearXNG JSON search request and formats the tool result text.
- `lib/assistant-runtime.ts`
  Register the optional SearXNG tool definition and execute it through the normal action timeline.
- `app/api/conversations/[conversationId]/chat/route.ts`
  Use user-scoped general settings and append Exa/Tavily synthetic MCP providers before discovery.
- `tests/unit/db.test.ts`
  Cover user settings migration defaults for the new columns.
- `tests/unit/settings.test.ts`
  Cover per-user persistence, sanitization, defaults, and Tavily/URL behavior.
- `tests/unit/general-section.test.tsx`
  Cover the new UI rendering, conditional fields, validation, and payload shape.
- `tests/unit/assistant-runtime.test.ts`
  Cover SearXNG tool definition and tool execution.
- `tests/unit/web-search.test.ts`
  New focused tests for derived provider selection and Exa/Tavily injection behavior.
- `tests/unit/searxng.test.ts`
  New focused tests for request construction, formatting, and error handling.
- `tests/e2e/features.spec.ts`
  Add a settings-level browser flow that verifies the new General settings UI.

### Task 1: Extend per-user settings storage for web search selection

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/db.ts`
- Modify: `lib/settings.ts`
- Modify: `app/api/settings/general/route.ts`
- Test: `tests/unit/db.test.ts`
- Test: `tests/unit/settings.test.ts`

- [ ] **Step 1: Write the failing DB migration test**

Add this test to `tests/unit/db.test.ts`:

```ts
  it("adds web search columns to user_settings during migration", async () => {
    const db = openLegacyDatabaseWithoutUserSearchColumns();

    migrate(db);

    const columns = (
      db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>
    ).map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "web_search_engine",
        "exa_api_key_encrypted",
        "tavily_api_key_encrypted",
        "searxng_base_url"
      ])
    );
  });
```

- [ ] **Step 2: Write the failing settings persistence tests**

Add these tests to `tests/unit/settings.test.ts`:

```ts
  it("defaults fresh user settings to Exa without any API keys", async () => {
    const user = await createLocalUser({
      username: "search-defaults",
      password: "changeme123",
      role: "user"
    });

    expect(getSettingsForUser(user.id)).toMatchObject({
      webSearchEngine: "exa",
      exaApiKey: "",
      tavilyApiKey: "",
      searxngBaseUrl: ""
    });
  });

  it("stores web search settings per user", async () => {
    const userA = await createLocalUser({ username: "search-a", password: "changeme123", role: "user" });
    const userB = await createLocalUser({ username: "search-b", password: "changeme123", role: "user" });

    updateGeneralSettingsForUser(userA.id, {
      webSearchEngine: "tavily",
      tavilyApiKey: "tvly-user-a"
    });
    updateGeneralSettingsForUser(userB.id, {
      webSearchEngine: "searxng",
      searxngBaseUrl: "https://search.example.com/"
    });

    expect(getSettingsForUser(userA.id)).toMatchObject({
      webSearchEngine: "tavily",
      tavilyApiKey: "tvly-user-a"
    });
    expect(getSettingsForUser(userB.id)).toMatchObject({
      webSearchEngine: "searxng",
      searxngBaseUrl: "https://search.example.com"
    });
  });
```

- [ ] **Step 3: Run the targeted tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/db.test.ts tests/unit/settings.test.ts
```

Expected: FAIL because `AppSettings` does not expose the new search fields, `user_settings` lacks the new columns, and `updateGeneralSettingsForUser` ignores the search settings payload.

- [ ] **Step 4: Add the new settings types**

Update `lib/types.ts` with:

```ts
export type WebSearchEngine = "exa" | "tavily" | "searxng" | "disabled";

export type AppSettings = {
  defaultProviderProfileId: string | null;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  sttEngine: SttEngine;
  sttLanguage: SttLanguage;
  webSearchEngine: WebSearchEngine;
  exaApiKey: string;
  tavilyApiKey: string;
  searxngBaseUrl: string;
  updatedAt: string;
};
```

- [ ] **Step 5: Add DB columns and migration logic**

Update `lib/db.ts` with these `user_settings` columns:

```ts
      web_search_engine TEXT NOT NULL DEFAULT 'exa',
      exa_api_key_encrypted TEXT NOT NULL DEFAULT '',
      tavily_api_key_encrypted TEXT NOT NULL DEFAULT '',
      searxng_base_url TEXT NOT NULL DEFAULT '',
```

and migration guards:

```ts
  if (!userSettingsColNames.includes("web_search_engine")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN web_search_engine TEXT NOT NULL DEFAULT 'exa'");
  }

  if (!userSettingsColNames.includes("exa_api_key_encrypted")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN exa_api_key_encrypted TEXT NOT NULL DEFAULT ''");
  }

  if (!userSettingsColNames.includes("tavily_api_key_encrypted")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN tavily_api_key_encrypted TEXT NOT NULL DEFAULT ''");
  }

  if (!userSettingsColNames.includes("searxng_base_url")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN searxng_base_url TEXT NOT NULL DEFAULT ''");
  }
```

- [ ] **Step 6: Thread the fields through settings reads and writes**

Update `lib/settings.ts` so `UserSettingsRow`, `rowToSettings`, `ensureUserSettingsRow`, `getUserSettingsRow`, `getSettingsForUser`, `getSanitizedSettings`, and `updateGeneralSettingsForUser` all carry the new fields:

```ts
function normalizeSearxngBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function rowToSettings(row: AppSettingsRow | UserSettingsRow): AppSettings {
  return {
    defaultProviderProfileId: row.default_provider_profile_id || null,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention as AppSettings["conversationRetention"],
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    mcpTimeout: row.mcp_timeout,
    sttEngine: (row.stt_engine ?? "browser") as AppSettings["sttEngine"],
    sttLanguage: (row.stt_language ?? "auto") as AppSettings["sttLanguage"],
    webSearchEngine: (row.web_search_engine ?? "exa") as AppSettings["webSearchEngine"],
    exaApiKey: row.exa_api_key_encrypted ? decryptValue(row.exa_api_key_encrypted) : "",
    tavilyApiKey: row.tavily_api_key_encrypted ? decryptValue(row.tavily_api_key_encrypted) : "",
    searxngBaseUrl: normalizeSearxngBaseUrl(row.searxng_base_url ?? ""),
    updatedAt: row.updated_at
  };
}
```

and in `updateGeneralSettingsForUser`:

```ts
  const next = {
    ...current,
    ...input,
    searxngBaseUrl:
      input.searxngBaseUrl !== undefined
        ? normalizeSearxngBaseUrl(input.searxngBaseUrl)
        : current.searxngBaseUrl,
    updatedAt: new Date().toISOString()
  };
```

plus:

```ts
       SET conversation_retention = ?,
           memories_enabled = ?,
           memories_max_count = ?,
           mcp_timeout = ?,
           stt_engine = ?,
           stt_language = ?,
           web_search_engine = ?,
           exa_api_key_encrypted = ?,
           tavily_api_key_encrypted = ?,
           searxng_base_url = ?,
           updated_at = ?
```

- [ ] **Step 7: Add API validation for the new fields**

Update `app/api/settings/general/route.ts` with:

```ts
const generalSettingsSchema = z
  .object({
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]).optional(),
    memoriesEnabled: z.coerce.boolean().optional(),
    memoriesMaxCount: z.coerce.number().int().min(1).max(500).optional(),
    mcpTimeout: z.coerce.number().int().min(10_000).max(600_000).optional(),
    sttEngine: z.enum(["browser", "embedded"]).optional(),
    sttLanguage: z.enum(["auto", "en", "fr", "es"]).optional(),
    webSearchEngine: z.enum(["exa", "tavily", "searxng", "disabled"]).optional(),
    exaApiKey: z.string().optional(),
    tavilyApiKey: z.string().optional(),
    searxngBaseUrl: z.string().optional()
  })
  .superRefine((value, context) => {
    if (value.webSearchEngine === "tavily" && !value.tavilyApiKey?.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tavilyApiKey"], message: "Tavily API key is required" });
    }

    if (value.webSearchEngine === "searxng") {
      const baseUrl = value.searxngBaseUrl?.trim() ?? "";

      if (!baseUrl) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["searxngBaseUrl"], message: "SearXNG URL is required" });
      } else {
        try {
          new URL(baseUrl);
        } catch {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["searxngBaseUrl"], message: "SearXNG URL must be valid" });
        }
      }
    }
  })
  .strip();
```

- [ ] **Step 8: Run the targeted tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/db.test.ts tests/unit/settings.test.ts
```

Expected: PASS with the new migration and per-user search settings tests green.

- [ ] **Step 9: Commit the settings schema slice**

```bash
git add lib/types.ts lib/db.ts lib/settings.ts app/api/settings/general/route.ts tests/unit/db.test.ts tests/unit/settings.test.ts
git commit -m "feat: store per-user web search settings"
```

### Task 2: Add the General settings UI for web search selection

**Files:**
- Modify: `components/settings/sections/general-section.tsx`
- Test: `tests/unit/general-section.test.tsx`

- [ ] **Step 1: Write the failing General settings UI tests**

Add these tests to `tests/unit/general-section.test.tsx`:

```tsx
  it("renders Exa as the default web search engine with an optional API key note", () => {
    render(React.createElement(GeneralSection, { settings: makeSettings() }));

    expect(screen.getByDisplayValue("Exa")).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Exa API key")).toBeInTheDocument();
  });

  it("requires a Tavily API key before saving", async () => {
    render(React.createElement(GeneralSection, {
      settings: makeSettings({ webSearchEngine: "tavily", tavilyApiKey: "" })
    }));

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Tavily API key is required")).toBeInTheDocument();
  });

  it("requires a SearXNG URL before saving", async () => {
    render(React.createElement(GeneralSection, {
      settings: makeSettings({ webSearchEngine: "searxng", searxngBaseUrl: "" })
    }));

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText("SearXNG URL is required")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the General settings test file to verify it fails**

Run:

```bash
npx vitest run tests/unit/general-section.test.tsx
```

Expected: FAIL because the component does not render the web search controls and cannot perform the new validation.

- [ ] **Step 3: Extend the settings test factory**

Update `makeSettings` in `tests/unit/general-section.test.tsx` to include:

```ts
    webSearchEngine: "exa",
    exaApiKey: "",
    tavilyApiKey: "",
    searxngBaseUrl: "",
```

- [ ] **Step 4: Implement the new General settings card**

Update `components/settings/sections/general-section.tsx` with new local state and save validation:

```tsx
  const [webSearchEngine, setWebSearchEngine] = useState(settings.webSearchEngine);
  const [exaApiKey, setExaApiKey] = useState(settings.exaApiKey);
  const [tavilyApiKey, setTavilyApiKey] = useState(settings.tavilyApiKey);
  const [searxngBaseUrl, setSearxngBaseUrl] = useState(settings.searxngBaseUrl);
```

and in `save()`:

```tsx
    if (webSearchEngine === "tavily" && !tavilyApiKey.trim()) {
      setError("Tavily API key is required");
      return;
    }

    if (webSearchEngine === "searxng" && !searxngBaseUrl.trim()) {
      setError("SearXNG URL is required");
      return;
    }
```

plus request body fields:

```tsx
        webSearchEngine,
        exaApiKey,
        tavilyApiKey,
        searxngBaseUrl
```

and render:

```tsx
      <SettingsCard title="Web Search">
        <SettingRow
          label="Search engine"
          description="Choose which built-in web search provider is available to the assistant."
        >
          <div className="flex w-full flex-col gap-3">
            <select
              aria-label="Web search engine"
              value={webSearchEngine}
              onChange={(event) => setWebSearchEngine(event.target.value as AppSettings["webSearchEngine"])}
              className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30 sm:w-auto"
            >
              <option value="exa">Exa</option>
              <option value="tavily">Tavily</option>
              <option value="searxng">SearXNG</option>
              <option value="disabled">Disabled</option>
            </select>

            {webSearchEngine === "exa" ? (
              <>
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/70">
                  Exa works without an API key on the public endpoint. Add one only if you want to use your own quota.
                </div>
                <input aria-label="Exa API key" type="password" value={exaApiKey} onChange={(event) => setExaApiKey(event.target.value)} className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30" />
              </>
            ) : null}

            {webSearchEngine === "tavily" ? (
              <input aria-label="Tavily API key" type="password" value={tavilyApiKey} onChange={(event) => setTavilyApiKey(event.target.value)} className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30" />
            ) : null}

            {webSearchEngine === "searxng" ? (
              <input aria-label="SearXNG URL" type="url" value={searxngBaseUrl} onChange={(event) => setSearxngBaseUrl(event.target.value)} placeholder="https://search.example.com" className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30" />
            ) : null}
          </div>
        </SettingRow>
      </SettingsCard>
```

- [ ] **Step 5: Run the General settings test file to verify it passes**

Run:

```bash
npx vitest run tests/unit/general-section.test.tsx
```

Expected: PASS with the new dropdown, conditional inputs, and client-side validation tests green.

- [ ] **Step 6: Commit the settings UI slice**

```bash
git add components/settings/sections/general-section.tsx tests/unit/general-section.test.tsx
git commit -m "feat: add web search controls to general settings"
```

### Task 3: Add the built-in search provider helper for Exa, Tavily, and Disabled

**Files:**
- Create: `lib/web-search.ts`
- Modify: `app/api/conversations/[conversationId]/chat/route.ts`
- Test: `tests/unit/web-search.test.ts`

- [ ] **Step 1: Write the failing provider-selection tests**

Create `tests/unit/web-search.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import { getBuiltInSearchProvider } from "@/lib/web-search";

describe("built-in web search provider", () => {
  it("returns Exa by default without an auth header", () => {
    const provider = getBuiltInSearchProvider({
      webSearchEngine: "exa",
      exaApiKey: "",
      tavilyApiKey: "",
      searxngBaseUrl: ""
    });

    expect(provider).toMatchObject({
      kind: "mcp",
      server: expect.objectContaining({
        name: "Exa",
        url: "https://mcp.exa.ai/mcp",
        headers: {}
      })
    });
  });

  it("returns Tavily with the API key in the URL query string", () => {
    const provider = getBuiltInSearchProvider({
      webSearchEngine: "tavily",
      exaApiKey: "",
      tavilyApiKey: "tvly-test",
      searxngBaseUrl: ""
    });

    expect(provider).toMatchObject({
      kind: "mcp",
      server: expect.objectContaining({
        url: "https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test"
      })
    });
  });

  it("returns null when web search is disabled", () => {
    expect(
      getBuiltInSearchProvider({
        webSearchEngine: "disabled",
        exaApiKey: "",
        tavilyApiKey: "",
        searxngBaseUrl: ""
      })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused provider-selection tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/web-search.test.ts
```

Expected: FAIL because `lib/web-search.ts` does not exist yet.

- [ ] **Step 3: Implement the built-in provider helper**

Create `lib/web-search.ts` with:

```ts
import type { AppSettings, McpServer, ToolDefinition } from "@/lib/types";

export type BuiltInSearchProvider =
  | { kind: "mcp"; server: McpServer }
  | { kind: "tool"; tool: ToolDefinition };

export function getBuiltInSearchProvider(
  settings: Pick<AppSettings, "webSearchEngine" | "exaApiKey" | "tavilyApiKey" | "searxngBaseUrl">
): BuiltInSearchProvider | null {
  if (settings.webSearchEngine === "disabled") {
    return null;
  }

  if (settings.webSearchEngine === "exa") {
    return {
      kind: "mcp",
      server: {
        id: "builtin_web_search_exa",
        name: "Exa",
        slug: "exa_builtin_search",
        url: "https://mcp.exa.ai/mcp",
        headers: settings.exaApiKey.trim() ? { "x-api-key": settings.exaApiKey.trim() } : {},
        transport: "streamable_http",
        command: null,
        args: null,
        env: null,
        enabled: true,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }
    };
  }

  if (settings.webSearchEngine === "tavily") {
    return {
      kind: "mcp",
      server: {
        id: "builtin_web_search_tavily",
        name: "Tavily",
        slug: "tavily_builtin_search",
        url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${encodeURIComponent(settings.tavilyApiKey.trim())}`,
        headers: {},
        transport: "streamable_http",
        command: null,
        args: null,
        env: null,
        enabled: true,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }
    };
  }

  return {
    kind: "tool",
    tool: {
      type: "function",
      function: {
        name: "web_search_searxng",
        description: "Search the web using the configured SearXNG instance.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" }
          },
          required: ["query"]
        }
      }
    }
  };
}
```

- [ ] **Step 4: Thread the helper into the chat route**

Update `app/api/conversations/[conversationId]/chat/route.ts` to use user-scoped settings and append only MCP-based built-in search providers:

```ts
  const appSettings = getSettingsForUser(user.id);
  const mcpServers = listEnabledMcpServers();
  const builtInSearchProvider = getBuiltInSearchProvider(appSettings);
  const runtimeMcpServers =
    builtInSearchProvider?.kind === "mcp"
      ? [...mcpServers, builtInSearchProvider.server]
      : mcpServers;
```

and later:

```ts
          mcpServers: runtimeMcpServers,
          mcpToolSets,
          builtInSearchProvider:
            builtInSearchProvider?.kind === "tool" ? builtInSearchProvider : null,
```

- [ ] **Step 5: Run the focused provider-selection tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/web-search.test.ts
```

Expected: PASS for Exa default, Tavily URL construction, and Disabled selection.

- [ ] **Step 6: Commit the built-in provider selection slice**

```bash
git add lib/web-search.ts app/api/conversations/[conversationId]/chat/route.ts tests/unit/web-search.test.ts
git commit -m "feat: derive built-in web search provider"
```

### Task 4: Add SearXNG execution and wire built-in search tools into assistant runtime

**Files:**
- Create: `lib/searxng.ts`
- Modify: `lib/assistant-runtime.ts`
- Test: `tests/unit/searxng.test.ts`
- Test: `tests/unit/assistant-runtime.test.ts`

- [ ] **Step 1: Write the failing SearXNG executor tests**

Create `tests/unit/searxng.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { runSearxngSearch } from "@/lib/searxng";

describe("runSearxngSearch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the configured instance search endpoint with format=json", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { title: "Example", url: "https://example.com", content: "Summary" }
          ]
        })
      )
    );

    const result = await runSearxngSearch("https://search.example.com", "test query");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://search.example.com/search?q=test+query&format=json",
      expect.any(Object)
    );
    expect(result).toContain("Example");
    expect(result).toContain("https://example.com");
  });
});
```

- [ ] **Step 2: Write the failing assistant runtime tool test**

Add this test to `tests/unit/assistant-runtime.test.ts`:

```ts
  it("adds the built-in SearXNG tool definition when selected", async () => {
    const result = await resolveAssistantTurn({
      settings: baseSettings(),
      promptMessages: [{ role: "user", content: "Search for release notes" }],
      skills: [],
      mcpServers: [],
      mcpToolSets: [],
      builtInSearchProvider: {
        kind: "tool",
        tool: {
          type: "function",
          function: {
            name: "web_search_searxng",
            description: "Search the web using the configured SearXNG instance.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"]
            }
          }
        },
        searxngBaseUrl: "https://search.example.com"
      },
      onProviderTools(tools) {
        expect(tools.some((tool) => tool.function.name === "web_search_searxng")).toBe(true);
      }
    });

    expect(result.answer).toBeDefined();
  });
```

- [ ] **Step 3: Run the focused tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/searxng.test.ts tests/unit/assistant-runtime.test.ts
```

Expected: FAIL because `lib/searxng.ts` does not exist and `resolveAssistantTurn` does not accept or expose a built-in SearXNG tool.

- [ ] **Step 4: Implement the SearXNG executor**

Create `lib/searxng.ts` with:

```ts
export async function runSearxngSearch(baseUrl: string, query: string) {
  const url = new URL("/search", `${baseUrl}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`SearXNG request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  const lines =
    payload.results?.slice(0, 5).map((item, index) =>
      `${index + 1}. ${item.title ?? item.url ?? "Untitled"}\n${item.url ?? ""}\n${item.content ?? ""}`.trim()
    ) ?? [];

  if (!lines.length) {
    return "No SearXNG results were returned for that query.";
  }

  return lines.join("\n\n");
}
```

- [ ] **Step 5: Wire the built-in tool into assistant runtime**

Update `lib/assistant-runtime.ts` by extending the input shape:

```ts
  builtInSearchProvider?: {
    kind: "tool";
    tool: ToolDefinition;
    searxngBaseUrl: string;
  } | null;
  onProviderTools?: (tools: ToolDefinition[]) => void;
```

append the tool in `buildToolDefinitions` call:

```ts
    if (input.builtInSearchProvider?.kind === "tool") {
      tools.push(input.builtInSearchProvider.tool);
    }
```

invoke the test hook:

```ts
    input.onProviderTools?.(tools);
```

and handle the new tool in `executeToolCall`:

```ts
  if (name === "web_search_searxng") {
    return executeSearxngToolCall(toolCallId, args, {
      ...context,
      builtInSearchProvider: context.input.builtInSearchProvider
    });
  }
```

with the executor:

```ts
async function executeSearxngToolCall(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      builtInSearchProvider?: { kind: "tool"; tool: ToolDefinition; searxngBaseUrl: string } | null;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const query = String(args.query ?? "").trim();

  if (!query) {
    return {
      nextSortOrder: context.timelineSortOrder,
      promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, "Error: query is required.")]
    };
  }

  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: "SearXNG search",
    detail: query,
    toolName: "web_search_searxng",
    arguments: { query }
  });

  try {
    const result = await runSearxngSearch(
      context.input.builtInSearchProvider?.searxngBaseUrl ?? "",
      query
    );

    await context.input.onActionComplete?.(typeof handle === "string" ? handle : undefined, {
      detail: query,
      resultSummary: result
    });

    return {
      nextSortOrder: context.timelineSortOrder + 1,
      promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, result)]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SearXNG search failed";
    await context.input.onActionError?.(typeof handle === "string" ? handle : undefined, {
      detail: query,
      resultSummary: message
    });

    return {
      nextSortOrder: context.timelineSortOrder + 1,
      promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, `Error: ${message}`)]
    };
  }
}
```

- [ ] **Step 6: Run the focused tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/searxng.test.ts tests/unit/assistant-runtime.test.ts
```

Expected: PASS for the SearXNG request construction, formatted result handling, and assistant-runtime built-in tool registration path.

- [ ] **Step 7: Commit the runtime search-tool slice**

```bash
git add lib/searxng.ts lib/assistant-runtime.ts tests/unit/searxng.test.ts tests/unit/assistant-runtime.test.ts
git commit -m "feat: add built-in searxng search tool"
```

### Task 5: Validate the full settings flow in the browser and run required verification

**Files:**
- Verify: `components/settings/sections/general-section.tsx`
- Verify: `app/settings/general/page.tsx`

- [ ] **Step 1: Start or reuse the dev server**

Run:

```bash
if [ -f .dev-server ]; then
  URL=$(head -n 1 .dev-server)
  curl -sf "$URL/settings/general" >/dev/null || rm .dev-server
fi

if [ ! -f .dev-server ]; then
  npm run dev > .context/web-search-dev.log 2>&1 &
fi
```

Then:

```bash
until [ -f .dev-server ]; do sleep 1; done
head -n 1 .dev-server
```

Expected: a reachable local URL from `.dev-server`.

- [ ] **Step 2: Validate the General settings UI with agent-browser**

Run:

```bash
URL=$(head -n 1 .dev-server)
agent-browser open "$URL/settings/general"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Expected: the General settings page loads with the new `Web Search` card visible.

- [ ] **Step 3: Verify Exa, Tavily, and SearXNG interactions**

From the `agent-browser snapshot -i` output, locate the ref for the `Web search engine` combobox and the ref for the `SearXNG URL` input, then run the interactions with those discovered refs:

```bash
agent-browser select @<web-search-engine-ref> "Exa"
agent-browser screenshot .context/general-settings-web-search-exa.png
agent-browser select @<web-search-engine-ref> "Tavily"
agent-browser screenshot .context/general-settings-web-search-tavily.png
agent-browser select @<web-search-engine-ref> "SearXNG"
agent-browser fill @<searxng-url-ref> "https://search.example.com"
agent-browser screenshot .context/general-settings-web-search-searxng.png
agent-browser select @<web-search-engine-ref> "Disabled"
agent-browser screenshot .context/general-settings-web-search-disabled.png
```

Confirm:

- Exa shows the optional info note and API key field
- Tavily shows only the required API key field
- SearXNG shows the required URL field
- Disabled hides provider-specific inputs

- [ ] **Step 4: Run the full required verification commands**

Run:

```bash
npm run lint
npm run typecheck
npm test
npx playwright test tests/e2e/features.spec.ts
```

Expected:

- `npm run lint`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: exit 0 with coverage generated and no global coverage regression
- `npx playwright test tests/e2e/features.spec.ts`: exit 0

- [ ] **Step 5: Commit the browser and end-to-end coverage changes**

```bash
git add tests/e2e/features.spec.ts
git commit -m "test: cover web search settings flow"
```

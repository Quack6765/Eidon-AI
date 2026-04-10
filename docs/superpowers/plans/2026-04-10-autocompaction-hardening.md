# Autocompaction Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Eidon's always-on autocompaction so long-running agent chats preserve high-signal state without carrying forward reasoning or raw tool logs, while fixing the settings surface to remove the dead toggle and present compaction threshold as `80%`.

**Architecture:** Keep the orchestration entrypoint in `lib/compaction.ts`, but split the new deterministic logic into focused pure helpers: one module for grouping/rendering completed work turns and one module for parsing/selecting stored summaries. Treat compaction as a full-context editing system: preserve recent completed turns verbatim, compact older completed turns into stable category-based summaries, deterministically retrieve only the summaries that match unresolved work or explicit artifact references, and never destructively drop stored memory nodes under prompt pressure.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library, SQLite via `better-sqlite3`

---

## File Structure

### Existing files to modify

- `lib/types.ts`
  - Remove `autoCompaction` from `AppSettings`.
  - Add `CompletedTurn` and `ParsedCompactionSummary` types if they are shared across modules.
  - Change `CompactionEvent.noticeMessageId` to `string | null`.
- `lib/settings.ts`
  - Remove top-level `autoCompaction` from the runtime settings contract.
  - Stop writing `auto_compaction` during settings updates.
  - Keep the database column untouched for compatibility.
  - Change the default compaction threshold to `0.8`.
  - Make the top-level settings update payload explicit enough that UI saves do not silently reset omitted settings.
- `lib/constants.ts`
  - Change `DEFAULT_PROVIDER_SETTINGS.compactionThreshold` from `0.78` to `0.8`.
- `components/settings/sections/general-section.tsx`
  - Remove the Auto-Compaction card and local state.
  - Preserve all unrelated settings when saving the general form.
- `components/settings/sections/providers-section.tsx`
  - Display `compactionThreshold` as a percentage.
  - Save it back as a decimal.
  - Preserve unrelated top-level settings during provider saves.
  - Update any copy that still implies `freshTailCount` is a raw message count.
- `lib/compaction.ts`
  - Stop carrying forward `thinkingContent`.
  - Replace LLM-based node scoring with deterministic retrieval.
  - Replace raw-message compaction eligibility with completed-turn eligibility.
  - Remove destructive node-dropping fallback.
  - Insert `compaction_events`.
  - Skip empty streaming assistant placeholders when building prompts.
- `tests/unit/settings.test.ts`
  - Update the settings contract expectations to reflect always-on compaction.
- `tests/unit/providers-section.test.tsx`
  - Add coverage for `%` UI behavior and full payload round-tripping.
- `tests/unit/settings-layout.test.tsx`
  - Remove `autoCompaction` from the fixture and assert the toggle no longer renders.
- `tests/unit/compaction.test.ts`
  - Update orchestration tests for deterministic retrieval, event persistence, and non-destructive fallback.
- `tests/unit/copilot-tools.test.ts`
  - Remove `autoCompaction` from the `AppSettings` fixture so the type stays aligned.

### New files to create

- `tests/unit/general-section.test.tsx`
  - Focused tests for the General settings form behavior and save payload.
- `lib/compaction-turns.ts`
  - Pure helpers for grouping completed work turns and rendering compactable turn text without reasoning or raw tool logs.
- `lib/compaction-summary.ts`
  - Pure helpers for parsing stored summary sections, extracting user signals, and selecting memory nodes deterministically.
- `tests/unit/compaction-turns.test.ts`
  - Unit tests for turn grouping and turn-to-summary-input rendering.
- `tests/unit/compaction-summary.test.ts`
  - Unit tests for summary parsing, signal extraction, and memory-node selection.

## Task 1: Remove The Dead Auto-Compaction Setting Surface

**Files:**
- Create: `tests/unit/general-section.test.tsx`
- Modify: `lib/types.ts`
- Modify: `lib/settings.ts`
- Modify: `components/settings/sections/general-section.tsx`
- Modify: `tests/unit/settings.test.ts`
- Modify: `tests/unit/settings-layout.test.tsx`
- Modify: `tests/unit/copilot-tools.test.ts`

- [ ] **Step 1: Write the failing settings contract test**

Add this test near the existing `settings storage` cases in `tests/unit/settings.test.ts`:

```ts
  it("does not expose auto-compaction in persisted or sanitized settings", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      conversationRetention: "forever",
      memoriesEnabled: true,
      memoriesMaxCount: 100,
      mcpTimeout: 120_000,
      providerProfiles: [alpha]
    });

    expect(getSettings()).toEqual(
      expect.not.objectContaining({
        autoCompaction: expect.anything()
      })
    );
    expect(getSanitizedSettings()).toEqual(
      expect.not.objectContaining({
        autoCompaction: expect.anything()
      })
    );
  });
```

- [ ] **Step 2: Write the failing General settings UI test**

Create `tests/unit/general-section.test.tsx`:

```tsx
// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GeneralSection } from "@/components/settings/sections/general-section";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh
  })
}));

describe("general section", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          settings: {
            defaultProviderProfileId: "profile_default",
            skillsEnabled: true,
            conversationRetention: "forever",
            memoriesEnabled: false,
            memoriesMaxCount: 42,
            mcpTimeout: 120_000,
            providerProfiles: [],
            updatedAt: new Date().toISOString()
          }
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ settings: {} })
      } as Response);
  });

  it("does not render the auto-compaction controls and preserves memory settings on save", async () => {
    render(
      <GeneralSection
        settings={{
          defaultProviderProfileId: "profile_default",
          skillsEnabled: true,
          conversationRetention: "forever",
          memoriesEnabled: false,
          memoriesMaxCount: 42,
          mcpTimeout: 120_000,
          updatedAt: new Date().toISOString()
        }}
      />
    );

    expect(screen.queryByText("Auto-Compaction")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"memoriesEnabled":false')
        })
      );
    });
  });
});
```

- [ ] **Step 3: Run the targeted tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/general-section.test.tsx tests/unit/settings-layout.test.tsx
```

Expected:

```text
FAIL  tests/unit/settings.test.ts
FAIL  tests/unit/general-section.test.tsx
```

The failures should show that `autoCompaction` is still present and the old UI still renders the toggle.

- [ ] **Step 4: Remove `autoCompaction` from the public settings contract**

Update `lib/types.ts`:

```ts
export type AppSettings = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  updatedAt: string;
};

export type CompactionEvent = {
  id: string;
  conversationId: string;
  nodeId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  noticeMessageId: string | null;
  createdAt: string;
};
```

Update `lib/settings.ts` so the top-level settings schema and mapper no longer surface `autoCompaction`, and the update statement stops writing the dead column:

```ts
const settingsSchema = z.object({
  defaultProviderProfileId: z.string().min(1),
  skillsEnabled: z.coerce.boolean(),
  conversationRetention: z.enum(["forever", "90d", "30d", "7d"]),
  memoriesEnabled: z.coerce.boolean(),
  memoriesMaxCount: z.coerce.number().int().min(1).max(500),
  mcpTimeout: z.coerce.number().int().min(10_000).max(600_000),
  providerProfiles: z.array(providerProfileInputSchema).min(1)
});

function rowToSettings(row: AppSettingsRow): AppSettings {
  return {
    defaultProviderProfileId: row.default_provider_profile_id,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention as AppSettings["conversationRetention"],
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    mcpTimeout: row.mcp_timeout,
    updatedAt: row.updated_at
  };
}
```

And update the SQL write:

```ts
getDb()
  .prepare(
    `UPDATE app_settings
     SET default_provider_profile_id = ?,
         skills_enabled = ?,
         conversation_retention = ?,
         memories_enabled = ?,
         memories_max_count = ?,
         mcp_timeout = ?,
         updated_at = ?
     WHERE id = ?`
  )
  .run(
    parsed.defaultProviderProfileId,
    parsed.skillsEnabled ? 1 : 0,
    parsed.conversationRetention,
    parsed.memoriesEnabled ? 1 : 0,
    parsed.memoriesMaxCount,
    parsed.mcpTimeout,
    timestamp,
    SETTINGS_ROW_ID
  );
```

- [ ] **Step 5: Remove the toggle from the General settings UI and preserve full settings on save**

Update `components/settings/sections/general-section.tsx`:

```tsx
export function GeneralSection({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [isPending] = useTransition();
  const [conversationRetention, setConversationRetention] = useState<ConversationRetention>(
    settings.conversationRetention
  );
  const [mcpTimeout, setMcpTimeout] = useState(settings.mcpTimeout);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setSuccess("");

    const current = await fetch("/api/settings").then((r) => r.json()) as {
      settings: {
        defaultProviderProfileId: string;
        skillsEnabled: boolean;
        conversationRetention: ConversationRetention;
        memoriesEnabled: boolean;
        memoriesMaxCount: number;
        mcpTimeout: number;
        providerProfiles: unknown[];
      };
    };

    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultProviderProfileId: current.settings.defaultProviderProfileId,
        skillsEnabled: current.settings.skillsEnabled,
        conversationRetention,
        memoriesEnabled: current.settings.memoriesEnabled,
        memoriesMaxCount: current.settings.memoriesMaxCount,
        mcpTimeout,
        providerProfiles: current.settings.providerProfiles
      })
    });
```

Delete the entire `SettingsCard title="Auto-Compaction"` block.

Update `tests/unit/settings-layout.test.tsx` and `tests/unit/copilot-tools.test.ts` fixtures by removing the `autoCompaction` field:

```ts
const settings: AppSettings = {
  defaultProviderProfileId: "profile_default",
  skillsEnabled: true,
  conversationRetention: "forever",
  memoriesEnabled: true,
  memoriesMaxCount: 100,
  mcpTimeout: 120_000,
  updatedAt: new Date().toISOString()
};
```

- [ ] **Step 6: Run the targeted tests again**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/general-section.test.tsx tests/unit/settings-layout.test.tsx tests/unit/copilot-tools.test.ts
```

Expected:

```text
PASS  tests/unit/settings.test.ts
PASS  tests/unit/general-section.test.tsx
PASS  tests/unit/settings-layout.test.tsx
PASS  tests/unit/copilot-tools.test.ts
```

- [ ] **Step 7: Commit the settings-surface cleanup**

Run:

```bash
git add lib/types.ts lib/settings.ts components/settings/sections/general-section.tsx tests/unit/settings.test.ts tests/unit/general-section.test.tsx tests/unit/settings-layout.test.tsx tests/unit/copilot-tools.test.ts
git commit -m "refactor: remove auto compaction settings surface"
```

## Task 2: Show Compaction Threshold As A Percentage And Default It To 80%

**Files:**
- Modify: `lib/constants.ts`
- Modify: `components/settings/sections/providers-section.tsx`
- Modify: `tests/unit/providers-section.test.tsx`
- Modify: `tests/unit/settings.test.ts`

- [ ] **Step 1: Add the failing threshold default test**

Extend the existing defaults test in `tests/unit/settings.test.ts`:

```ts
  it("returns default provider settings including the 80 percent compaction threshold", () => {
    const defaults = getSettingsDefaults();

    expect(defaults.name).toBe("Default profile");
    expect(defaults.visionMode).toBe("native");
    expect(defaults.visionMcpServerId).toBeNull();
    expect(defaults.compactionThreshold).toBe(0.8);
  });
```

- [ ] **Step 2: Add the failing providers UI behavior test**

Append this case to `tests/unit/providers-section.test.tsx`:

```tsx
  it("shows compaction threshold as a percentage and saves it back as a decimal", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ servers: [], models: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ settings: {} })
      } as Response);

    render(
      <ProvidersSection
        settings={{
          defaultProviderProfileId: "profile_default",
          skillsEnabled: true,
          conversationRetention: "forever",
          memoriesEnabled: true,
          memoriesMaxCount: 100,
          mcpTimeout: 120_000,
          providerProfiles: [
            {
              id: "profile_default",
              providerKind: "openai_compatible",
              name: "Default",
              apiBaseUrl: "https://api.example.com/v1",
              model: "gpt-test",
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
        }}
      />
    );

    fireEvent.change(screen.getByDisplayValue("80"), {
      target: { value: "85" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"compactionThreshold":0.85')
        })
      );
    });
  });
```

- [ ] **Step 3: Run the targeted tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/providers-section.test.tsx
```

Expected:

```text
FAIL  tests/unit/settings.test.ts
FAIL  tests/unit/providers-section.test.tsx
```

The failures should show the old `0.78` default and raw decimal UI value.

- [ ] **Step 4: Change the runtime default and percentage UI contract**

Update `lib/constants.ts`:

```ts
export const DEFAULT_PROVIDER_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  apiMode: "responses",
  systemPrompt: "...",
  temperature: 0.7,
  maxOutputTokens: 1200,
  reasoningEffort: "medium",
  reasoningSummaryEnabled: true,
  modelContextLimit: 128000,
  compactionThreshold: 0.8,
  freshTailCount: 28,
  tokenizerModel: "gpt-tokenizer" as const,
  safetyMarginTokens: 1200,
  leafSourceTokenLimit: 12000,
  leafMinMessageCount: 6,
  mergedMinNodeCount: 4,
  mergedTargetTokens: 1600,
  visionMode: "native" as const,
  visionMcpServerId: null
} as const;
```

Update the draft seed and payload shape in `components/settings/sections/providers-section.tsx`:

```tsx
type SettingsPayload = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  conversationRetention: "forever" | "90d" | "30d" | "7d";
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  providerProfiles: Array<{
    // unchanged
  }>;
  updatedAt: string;
};

const DEFAULT_COMPACTION_THRESHOLD_PERCENT = 80;

function thresholdDecimalToPercent(value: number) {
  return Math.round(value * 100);
}

function thresholdPercentToDecimal(value: number) {
  return Number((value / 100).toFixed(2));
}
```

Update the new-profile draft default:

```tsx
        compactionThreshold: 0.8,
```

Update the input control:

```tsx
                    <div>
                      <label className={labelClass}>Compaction threshold (%)</label>
                      <Input
                        name="provider-compaction-threshold"
                        type="number"
                        min="50"
                        max="95"
                        step="1"
                        value={
                          activeProviderProfile
                            ? thresholdDecimalToPercent(activeProviderProfile.compactionThreshold)
                            : DEFAULT_COMPACTION_THRESHOLD_PERCENT
                        }
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            compactionThreshold: thresholdPercentToDecimal(
                              Number(event.target.value || DEFAULT_COMPACTION_THRESHOLD_PERCENT)
                            )
                          })
                        }
                      />
                    </div>
```

- [ ] **Step 5: Update the fresh-tail copy so the UI matches the new turn-based semantics**

Update the fresh-tail field label in `components/settings/sections/providers-section.tsx`:

```tsx
                    <div>
                      <label className={labelClass}>Fresh tail turns</label>
                      <Input
                        name="provider-fresh-tail-count"
                        type="number"
                        value={activeProviderProfile.freshTailCount}
                        onChange={(event) =>
                          updateActiveProviderProfile({
                            freshTailCount: Number(event.target.value || 0)
                          })
                        }
                      />
                    </div>
```

- [ ] **Step 6: Preserve top-level settings when provider settings are saved**

Update `buildSettingsPayload()` in `components/settings/sections/providers-section.tsx`:

```tsx
  async function buildSettingsPayload() {
    return {
      defaultProviderProfileId,
      skillsEnabled,
      conversationRetention: settings.conversationRetention,
      memoriesEnabled: settings.memoriesEnabled,
      memoriesMaxCount: settings.memoriesMaxCount,
      mcpTimeout: settings.mcpTimeout,
      providerProfiles: providerProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        providerKind: profile.providerKind ?? "openai_compatible",
        apiBaseUrl: profile.apiBaseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        apiMode: profile.apiMode,
        systemPrompt: profile.systemPrompt,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        reasoningEffort: profile.reasoningEffort,
        reasoningSummaryEnabled: profile.reasoningSummaryEnabled,
        modelContextLimit: profile.modelContextLimit,
        compactionThreshold: profile.compactionThreshold,
        freshTailCount: profile.freshTailCount,
        tokenizerModel: profile.tokenizerModel,
        safetyMarginTokens: profile.safetyMarginTokens,
        leafSourceTokenLimit: profile.leafSourceTokenLimit,
        leafMinMessageCount: profile.leafMinMessageCount,
        mergedMinNodeCount: profile.mergedMinNodeCount,
        mergedTargetTokens: profile.mergedTargetTokens,
        visionMode: profile.visionMode ?? "native",
        visionMcpServerId: profile.visionMcpServerId ?? null,
        githubAccountLogin: profile.githubAccountLogin ?? null,
        githubAccountName: profile.githubAccountName ?? null,
        githubTokenExpiresAt: profile.githubTokenExpiresAt ?? null,
        githubRefreshTokenExpiresAt: profile.githubRefreshTokenExpiresAt ?? null
      }))
    };
  }
```

- [ ] **Step 7: Run the targeted tests again**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/providers-section.test.tsx
```

Expected:

```text
PASS  tests/unit/settings.test.ts
PASS  tests/unit/providers-section.test.tsx
```

- [ ] **Step 8: Commit the threshold UI change**

Run:

```bash
git add lib/constants.ts components/settings/sections/providers-section.tsx tests/unit/settings.test.ts tests/unit/providers-section.test.tsx
git commit -m "fix: show compaction threshold as a percentage"
```

## Task 3: Group Completed Work Turns And Stop Carrying Forward Reasoning

**Files:**
- Create: `lib/compaction-turns.ts`
- Create: `tests/unit/compaction-turns.test.ts`
- Modify: `lib/compaction.ts`
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the failing completed-turn tests**

Create `tests/unit/compaction-turns.test.ts`:

```ts
import { collectCompletedTurns, renderTurnForCompaction } from "@/lib/compaction-turns";
import type { Message } from "@/lib/types";

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    conversationId: overrides.conversationId ?? "conv_1",
    role: overrides.role ?? "user",
    content: overrides.content ?? "",
    thinkingContent: overrides.thinkingContent ?? "",
    status: overrides.status ?? "completed",
    estimatedTokens: overrides.estimatedTokens ?? 10,
    systemKind: overrides.systemKind ?? null,
    compactedAt: overrides.compactedAt ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    actions: overrides.actions ?? [],
    attachments: overrides.attachments ?? []
  };
}

describe("compaction turns", () => {
  it("groups a completed user turn with its assistant answer and skips the streaming placeholder", () => {
    const turns = collectCompletedTurns([
      makeMessage({ id: "user_1", role: "user", content: "Diagnose the failing job" }),
      makeMessage({
        id: "assistant_1",
        role: "assistant",
        content: "I found the missing env bootstrap.",
        thinkingContent: "internal reasoning should not matter"
      }),
      makeMessage({
        id: "user_2",
        role: "user",
        content: "Ship the fix"
      }),
      makeMessage({
        id: "assistant_stream",
        role: "assistant",
        content: "",
        status: "streaming"
      })
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.userMessage.id).toBe("user_1");
    expect(turns[0]?.assistantMessage?.id).toBe("assistant_1");
  });

  it("renders tool outcomes without reasoning or raw log blobs", () => {
    const [turn] = collectCompletedTurns([
      makeMessage({
        id: "user_1",
        role: "user",
        content: "Inspect the workflow log"
      }),
      makeMessage({
        id: "assistant_1",
        role: "assistant",
        content: "The workflow fails before test bootstrap completes.",
        thinkingContent: "do not include this in compaction",
        actions: [
          {
            id: "act_1",
            messageId: "assistant_1",
            kind: "shell_command",
            status: "completed",
            serverId: null,
            skillId: null,
            toolName: "execute_shell_command",
            label: "execute_shell_command",
            detail: "tail -200 workflow.log",
            arguments: null,
            resultSummary: "Found missing ENV setup before vitest boot.",
            sortOrder: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          }
        ]
      })
    ]);

    const rendered = renderTurnForCompaction(turn!);

    expect(rendered).toContain("Found missing ENV setup before vitest boot.");
    expect(rendered).not.toContain("do not include this in compaction");
    expect(rendered).not.toContain("tail -200 workflow.log");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/compaction-turns.test.ts
```

Expected:

```text
FAIL  tests/unit/compaction-turns.test.ts
```

The module does not exist yet.

- [ ] **Step 3: Implement the completed-turn helper module**

Create `lib/compaction-turns.ts`:

```ts
import { estimateMessageTokens, estimateTextTokens } from "@/lib/tokenization";
import type { Message, MessageAction, MessageAttachment } from "@/lib/types";

export type CompletedTurn = {
  userMessage: Message;
  assistantMessage: Message | null;
  sourceMessages: Message[];
  sourceTokenCount: number;
  artifactRefs: string[];
};

const TERMINAL_ASSISTANT_STATUSES = new Set(["completed", "error", "stopped"] as const);

function summarizeAction(action: MessageAction) {
  return action.resultSummary.trim() || action.label.trim();
}

function attachmentRefs(attachments: MessageAttachment[]) {
  return attachments.map((attachment) => attachment.filename);
}

function buildCompletedTurn(userMessage: Message, assistantMessage: Message | null): CompletedTurn {
  const actionSummaries = (assistantMessage?.actions ?? [])
    .filter((action) => action.status !== "running")
    .map(summarizeAction);
  const refs = [
    ...attachmentRefs(userMessage.attachments ?? []),
    ...actionSummaries
      .flatMap((text) => text.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+|https?:\/\/\S+|run id \d+)/g) ?? [])
  ];

  return {
    userMessage,
    assistantMessage,
    sourceMessages: assistantMessage ? [userMessage, assistantMessage] : [userMessage],
    sourceTokenCount:
      estimateMessageTokens(userMessage) + (assistantMessage ? estimateMessageTokens(assistantMessage) : 0),
    artifactRefs: refs
  };
}

export function collectCompletedTurns(messages: Message[]) {
  const visible = messages.filter((message) => message.role !== "system" && !message.compactedAt);
  const turns: CompletedTurn[] = [];
  let currentUser: Message | null = null;

  for (const message of visible) {
    if (message.role === "user") {
      currentUser = message;
      continue;
    }

    if (!currentUser) continue;
    if (!TERMINAL_ASSISTANT_STATUSES.has(message.status as "completed" | "error" | "stopped")) continue;
    if (!message.content.trim()) continue;

    turns.push(buildCompletedTurn(currentUser, message));
    currentUser = null;
  }

  return turns;
}

export function renderTurnForCompaction(turn: CompletedTurn) {
  const lines = [
    `[user] ${turn.userMessage.id}`,
    turn.userMessage.content.trim(),
    ...(turn.userMessage.attachments ?? []).map((attachment) => `artifact: ${attachment.filename}`),
    turn.assistantMessage ? `[assistant] ${turn.assistantMessage.id}` : "",
    turn.assistantMessage?.content.trim() ?? "",
    ...(turn.assistantMessage?.actions ?? [])
      .filter((action) => action.status !== "running")
      .map((action) => `outcome: ${summarizeAction(action)}`)
  ].filter(Boolean);

  return lines.join("\n");
}

export function estimateRenderedTurnTokens(turn: CompletedTurn) {
  return estimateTextTokens(renderTurnForCompaction(turn));
}
```

- [ ] **Step 4: Wire the prompt builder to stop carrying forward `thinkingContent` and empty streaming placeholders**

Update the assistant branch in `lib/compaction.ts`:

```ts
  input.messages.forEach((message) => {
    if (message.role === "system") return;

    if (message.role === "assistant") {
      if (message.status === "streaming" && !message.content.trim()) {
        return;
      }

      if (!message.content.trim()) {
        return;
      }

      promptMessages.push({
        role: "assistant",
        content: `Answer:\n${message.content}`
      });
      return;
    }

    promptMessages.push({
      role: "user",
      content: buildUserPromptContent(message, remainingAttachmentTextTokens)
    });
  });
```

Also import and use `CompletedTurn` types from the new module if you moved them out of `lib/types.ts`.

- [ ] **Step 5: Run the focused tests again**

Run:

```bash
npx vitest run tests/unit/compaction-turns.test.ts tests/unit/compaction.test.ts
```

Expected:

```text
PASS  tests/unit/compaction-turns.test.ts
PASS  tests/unit/compaction.test.ts
```

If `tests/unit/compaction.test.ts` still passes unexpectedly while reasoning is included, add an explicit assertion there in Task 5 when the orchestration is rewired.

- [ ] **Step 6: Commit the completed-turn groundwork**

Run:

```bash
git add lib/compaction-turns.ts lib/compaction.ts lib/types.ts tests/unit/compaction-turns.test.ts
git commit -m "refactor: compact completed turns without reasoning"
```

## Task 4: Add Deterministic Summary Parsing And Memory Selection

**Files:**
- Create: `lib/compaction-summary.ts`
- Create: `tests/unit/compaction-summary.test.ts`
- Modify: `lib/compaction.ts`

- [ ] **Step 1: Add the failing deterministic retrieval tests**

Create `tests/unit/compaction-summary.test.ts`:

```ts
import { parseSummarySections, selectMemoryNodesForPrompt } from "@/lib/compaction-summary";
import type { MemoryNode } from "@/lib/types";

function makeNode(id: string, content: string, summaryTokenCount: number, createdAt: string): MemoryNode {
  return {
    id,
    conversationId: "conv_1",
    type: "leaf_summary",
    depth: 0,
    content,
    sourceStartMessageId: `${id}_start`,
    sourceEndMessageId: `${id}_end`,
    sourceTokenCount: 200,
    summaryTokenCount,
    childNodeIds: [],
    supersededByNodeId: null,
    createdAt
  };
}

describe("compaction summary parsing", () => {
  it("extracts open tasks and artifact references from the stable heading format", () => {
    const sections = parseSummarySections(`Goal:\n- Fix CI\n\nOpen Tasks:\n- Re-run GitHub Actions\n\nArtifact References:\n- .github/workflows/ci.yml`);

    expect(sections.openTasks).toEqual(["Re-run GitHub Actions"]);
    expect(sections.artifactRefs).toEqual([".github/workflows/ci.yml"]);
  });

  it("selects unresolved and matching artifact nodes before recency backfill while honoring budget", () => {
    const selected = selectMemoryNodesForPrompt({
      activeNodes: [
        makeNode(
          "mem_open",
          "Goal:\n- Fix CI\n\nOpen Tasks:\n- Re-run GitHub Actions\n\nArtifact References:\n- .github/workflows/ci.yml",
          40,
          "2026-04-10T10:00:00.000Z"
        ),
        makeNode(
          "mem_file",
          "Goal:\n- Update settings\n\nOpen Tasks:\n- None\n\nArtifact References:\n- components/settings/sections/providers-section.tsx",
          40,
          "2026-04-10T11:00:00.000Z"
        ),
        makeNode(
          "mem_old",
          "Goal:\n- Old archived work\n\nOpen Tasks:\n- None\n\nArtifact References:\n- docs/old.md",
          40,
          "2026-04-10T09:00:00.000Z"
        )
      ],
      latestUserMessage: "Please update components/settings/sections/providers-section.tsx after re-running GitHub Actions.",
      maxSummaryTokens: 85
    });

    expect(selected.map((node) => node.id)).toEqual(["mem_open", "mem_file"]);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/compaction-summary.test.ts
```

Expected:

```text
FAIL  tests/unit/compaction-summary.test.ts
```

The module does not exist yet.

- [ ] **Step 3: Implement the summary parser and deterministic selector**

Create `lib/compaction-summary.ts`:

```ts
import type { MemoryNode } from "@/lib/types";

export type ParsedCompactionSummary = {
  goal: string[];
  constraints: string[];
  actionsTaken: string[];
  outcomes: string[];
  openTasks: string[];
  artifactRefs: string[];
  timeSpan: string[];
};

const SECTION_HEADERS: Array<[keyof ParsedCompactionSummary, string]> = [
  ["goal", "Goal:"],
  ["constraints", "Constraints:"],
  ["actionsTaken", "Actions Taken:"],
  ["outcomes", "Outcomes:"],
  ["openTasks", "Open Tasks:"],
  ["artifactRefs", "Artifact References:"],
  ["timeSpan", "Time Span:"]
];

export function parseSummarySections(content: string): ParsedCompactionSummary {
  const parsed: ParsedCompactionSummary = {
    goal: [],
    constraints: [],
    actionsTaken: [],
    outcomes: [],
    openTasks: [],
    artifactRefs: [],
    timeSpan: []
  };

  let currentKey: keyof ParsedCompactionSummary | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    const matchedHeader = SECTION_HEADERS.find(([, header]) => line === header);

    if (matchedHeader) {
      currentKey = matchedHeader[0];
      continue;
    }

    if (!currentKey || !line.startsWith("-")) continue;
    parsed[currentKey].push(line.slice(1).trim());
  }

  return parsed;
}

function extractUserSignals(userInput: string) {
  return new Set(
    (userInput.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+|https?:\/\/\S+|run id \d+)/g) ?? []).map((item) =>
      item.toLowerCase()
    )
  );
}

export function selectMemoryNodesForPrompt(input: {
  activeNodes: MemoryNode[];
  latestUserMessage: string;
  maxSummaryTokens: number;
}) {
  const signals = extractUserSignals(input.latestUserMessage);

  const ranked = input.activeNodes
    .map((node) => {
      const parsed = parseSummarySections(node.content);
      const hasOpenTasks = parsed.openTasks.some((task) => task.toLowerCase() !== "none");
      const hasSignalMatch = parsed.artifactRefs.some((ref) => signals.has(ref.toLowerCase()));

      return {
        node,
        priority: hasOpenTasks ? 0 : hasSignalMatch ? 1 : 2
      };
    })
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return right.node.createdAt.localeCompare(left.node.createdAt);
    });

  let remaining = input.maxSummaryTokens;
  const selected: MemoryNode[] = [];

  for (const item of ranked) {
    const cost = Math.max(item.node.summaryTokenCount, 1);
    if (cost > remaining) continue;
    selected.push(item.node);
    remaining -= cost;
  }

  return selected;
}
```

- [ ] **Step 4: Update the compaction prompt to emit stable summary headings**

Replace the summary instructions in `buildSummaryPrompt(...)` inside `lib/compaction.ts`:

```ts
  parts.push(
    `You are compacting ${label} for a chat memory engine.`,
    "",
    "Return concise bullet lists under these exact headings:",
    "Goal:",
    "Constraints:",
    "Actions Taken:",
    "Outcomes:",
    "Open Tasks:",
    "Artifact References:",
    "Time Span:",
    "",
    "Rules:",
    "- Preserve decisions, constraints, completed work, unresolved work, and artifact references.",
    "- Do not include chain-of-thought or speculative reasoning.",
    "- Collapse raw tool logs into one-line outcomes.",
    "- Mention files, commands, URLs, and IDs only when they matter later.",
    "- Use `- None` for an empty section.",
    "",
    blocks,
    "",
    `sourceSpan: startMessageId=\"${sourceSpan.startMessageId}\", endMessageId=\"${sourceSpan.endMessageId}\", messageCount=${sourceSpan.messageCount}`
  );
```

- [ ] **Step 5: Run the focused tests again**

Run:

```bash
npx vitest run tests/unit/compaction-summary.test.ts
```

Expected:

```text
PASS  tests/unit/compaction-summary.test.ts
```

- [ ] **Step 6: Commit the deterministic retrieval helpers**

Run:

```bash
git add lib/compaction-summary.ts lib/compaction.ts tests/unit/compaction-summary.test.ts
git commit -m "feat: add deterministic compaction summary selection"
```

## Task 5: Rewire Compaction Orchestration, Fallback, And Event Persistence

**Files:**
- Modify: `lib/compaction.ts`
- Modify: `tests/unit/compaction.test.ts`

- [ ] **Step 1: Add the failing orchestration regressions**

Append these tests to `tests/unit/compaction.test.ts`:

```ts
  it("does not carry forward assistant reasoning in fresh prompt context", async () => {
    updateDefaultProfile({});

    const conversation = createConversation();
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Summarize the current fix"
    });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "The fix updates the provider settings UI.",
      thinkingContent: "private reasoning that should never be replayed"
    });

    const result = await ensureCompactedContext(
      conversation.id,
      getDefaultProviderProfileWithApiKey()!
    );

    expect(
      result.promptMessages.some((message) =>
        typeof message.content === "string" &&
        message.content.includes("private reasoning that should never be replayed")
      )
    ).toBe(false);
  });

  it("persists a compaction event when a leaf summary is created", async () => {
    updateDefaultProfile({
      modelContextLimit: 6000,
      compactionThreshold: 0.7
    });

    const conversation = createConversation();

    for (let index = 0; index < 18; index += 1) {
      createMessage({
        conversationId: conversation.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index} ${"dense context ".repeat(90)}`
      });
    }

    await ensureCompactedContext(conversation.id, getDefaultProviderProfileWithApiKey()!);

    expect(getConversationDebugStats(conversation.id).latestCompactionAt).not.toBeNull();
  });

  it("does not permanently drop stored memory nodes when the prompt is still over budget", async () => {
    updateDefaultProfile({
      modelContextLimit: 4096,
      compactionThreshold: 0.6,
      freshTailCount: 8
    });

    const conversation = createConversation();

    for (let index = 0; index < 24; index += 1) {
      createMessage({
        conversationId: conversation.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Large turn ${index} ${"payload ".repeat(120)}`
      });
    }

    await ensureCompactedContext(conversation.id, getDefaultProviderProfileWithApiKey()!);
    const before = getConversationDebugStats(conversation.id).memoryNodeCount;
    await ensureCompactedContext(conversation.id, getDefaultProviderProfileWithApiKey()!);
    const after = getConversationDebugStats(conversation.id).memoryNodeCount;

    expect(after).toBeGreaterThanOrEqual(before);
  });
```

- [ ] **Step 2: Run the orchestration tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/compaction.test.ts
```

Expected:

```text
FAIL  tests/unit/compaction.test.ts
```

The failures should show reasoning still being replayed, `latestCompactionAt` still null, or node counts dropping after repeated pressure.

- [ ] **Step 3: Rebuild the compaction orchestration around completed turns and deterministic retrieval**

Update `lib/compaction.ts` with these core changes:

```ts
import { collectCompletedTurns, estimateRenderedTurnTokens, renderTurnForCompaction } from "@/lib/compaction-turns";
import { parseSummarySections, selectMemoryNodesForPrompt } from "@/lib/compaction-summary";
```

Add compaction-event persistence:

```ts
function insertCompactionEvent(input: {
  conversationId: string;
  nodeId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO compaction_events (
        id,
        conversation_id,
        node_id,
        source_start_message_id,
        source_end_message_id,
        notice_message_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      createId("cmp"),
      input.conversationId,
      input.nodeId,
      input.sourceStartMessageId,
      input.sourceEndMessageId,
      new Date().toISOString()
    );
}
```

Replace the leaf-compaction selection with completed turns:

```ts
function getCompactionEligibleTurns(messages: Message[], freshTailCount: number) {
  const turns = collectCompletedTurns(messages);
  if (turns.length <= freshTailCount) {
    return [];
  }
  return turns.slice(0, turns.length - freshTailCount);
}
```

Update `compactLeafMessages(...)` to operate on turns:

```ts
async function compactLeafTurns(
  conversationId: string,
  turns: CompletedTurn[],
  settings: ProviderProfileWithApiKey,
  hooks: Pick<CompactionLifecycleHooks, "onCompactionStart">
) {
  hooks.onCompactionStart?.();

  if (turns.length < settings.leafMinMessageCount) {
    return null;
  }

  let sourceTokenCount = 0;
  const selected: CompletedTurn[] = [];

  for (const turn of turns) {
    const turnTokenCount = estimateRenderedTurnTokens(turn);

    if (
      selected.length >= settings.leafMinMessageCount &&
      sourceTokenCount + turnTokenCount > settings.leafSourceTokenLimit
    ) {
      break;
    }

    selected.push(turn);
    sourceTokenCount += turnTokenCount;
  }

  if (selected.length < settings.leafMinMessageCount) {
    return null;
  }

  const blocks = selected.map(renderTurnForCompaction).join("\n\n");
  const payload = await summarizeBlocks(
    conversationId,
    buildSummaryPrompt("completed work turns", blocks, {
      startMessageId: selected[0]!.userMessage.id,
      endMessageId: selected[selected.length - 1]!.assistantMessage?.id ?? selected[selected.length - 1]!.userMessage.id,
      messageCount: selected.length
    }),
    settings
  );

  const node = insertMemoryNode({
    conversationId,
    type: "leaf_summary",
    depth: 0,
    content: payload,
    sourceStartMessageId: selected[0]!.userMessage.id,
    sourceEndMessageId: selected[selected.length - 1]!.assistantMessage?.id ?? selected[selected.length - 1]!.userMessage.id,
    sourceTokenCount,
    summaryTokenCount: estimateTextTokens(payload),
    childNodeIds: []
  });

  markMessagesCompacted(
    selected.flatMap((turn) => turn.sourceMessages.map((message) => message.id))
  );
  insertCompactionEvent({
    conversationId,
    nodeId: node.id,
    sourceStartMessageId: node.sourceStartMessageId,
    sourceEndMessageId: node.sourceEndMessageId
  });
  bumpConversation(conversationId);

  return { node, sourceTurns: selected };
}
```

Replace retrieval selection and fallback inside `ensureCompactedContext(...)`:

```ts
      const completedTurns = collectCompletedTurns(messages);
      const trailingMessages = visibleMessages.filter((message) => {
        if (message.role === "system") return false;
        if (message.role === "assistant" && message.status === "streaming" && !message.content.trim()) {
          return false;
        }
        return !message.compactedAt;
      });

      const freshTurns = completedTurns.slice(-effectiveFreshTail);
      const freshMessages = freshTurns.flatMap((turn) => turn.sourceMessages);
      const latestUserMessage = [...visibleMessages].reverse().find((message) => message.role === "user");

      const selectedNodes = selectMemoryNodesForPrompt({
        activeNodes,
        latestUserMessage: latestUserMessage?.content ?? "",
        maxSummaryTokens: Math.max(Math.floor(compactionLimit * 0.35), 256)
      });

      const promptMessages = buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        personaContent,
        messages: [...freshMessages, ...(latestUserMessage && !freshMessages.some((message) => message.id === latestUserMessage.id) ? [latestUserMessage] : [])],
        activeMemoryNodes: selectedNodes,
        maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
        memoriesEnabled
      });
```

Replace the old destructive fallback:

```ts
      if (effectiveFreshTail > MIN_FRESH_TAIL) {
        effectiveFreshTail -= 1;
        continue;
      }

      const openTaskNodes = activeMemoryNodes.filter((node) => {
        const parsed = parseSummarySections(node.content);
        return parsed.openTasks.some((task) => task.toLowerCase() !== "none");
      });

      const fallbackMessages = latestUserMessage ? [latestUserMessage] : [];
      const fallbackPrompt = buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        personaContent,
        messages: fallbackMessages,
        activeMemoryNodes: openTaskNodes,
        memoriesEnabled
      });

      return {
        promptMessages: fallbackPrompt,
        promptTokens: estimatePromptTokens(fallbackPrompt),
        didCompact
      };
```

Delete `scoreMemoryNodes(...)` and stop calling `dropOldestMemoryNode(...)` from the prompt-pressure path.

- [ ] **Step 4: Run the focused compaction tests again**

Run:

```bash
npx vitest run tests/unit/compaction-turns.test.ts tests/unit/compaction-summary.test.ts tests/unit/compaction.test.ts
```

Expected:

```text
PASS  tests/unit/compaction-turns.test.ts
PASS  tests/unit/compaction-summary.test.ts
PASS  tests/unit/compaction.test.ts
```

- [ ] **Step 5: Run the full regression slice for settings and compaction**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/general-section.test.tsx tests/unit/providers-section.test.tsx tests/unit/settings-layout.test.tsx tests/unit/copilot-tools.test.ts tests/unit/compaction-turns.test.ts tests/unit/compaction-summary.test.ts tests/unit/compaction.test.ts
```

Expected:

```text
PASS  tests/unit/settings.test.ts
PASS  tests/unit/general-section.test.tsx
PASS  tests/unit/providers-section.test.tsx
PASS  tests/unit/settings-layout.test.tsx
PASS  tests/unit/copilot-tools.test.ts
PASS  tests/unit/compaction-turns.test.ts
PASS  tests/unit/compaction-summary.test.ts
PASS  tests/unit/compaction.test.ts
```

- [ ] **Step 6: Commit the compaction core hardening**

Run:

```bash
git add lib/compaction.ts lib/compaction-turns.ts lib/compaction-summary.ts tests/unit/compaction.test.ts tests/unit/compaction-turns.test.ts tests/unit/compaction-summary.test.ts
git commit -m "fix: harden autocompaction retrieval and fallback"
```

## Self-Review

### Spec coverage

- Always-on compaction with no toggle:
  - covered by Task 1
- Threshold shown as percent with `80%` default:
  - covered by Task 2
- Reasoning excluded from future prompts and compacted memory:
  - covered by Task 3 and Task 5
- Raw tool logs collapsed into outcomes:
  - covered by Task 3
- Deterministic retrieval with unresolved work and artifact references:
  - covered by Task 4 and Task 5
- Budget-safe selection:
  - covered by Task 4
- Non-destructive fallback:
  - covered by Task 5
- Real `compaction_events` persistence and debug timestamps:
  - covered by Task 5

### Placeholder scan

- No `TODO`, `TBD`, or “handle appropriately” placeholders remain.
- Every code-changing step includes the concrete code to add or replace.
- Every verification step names exact files and commands.

### Type consistency

- `AppSettings` no longer includes `autoCompaction`; every fixture update in Tasks 1 and 2 reflects that.
- `CompactionEvent.noticeMessageId` is nullable everywhere.
- `compactionThreshold` stays stored as decimal and is only converted at the Providers UI boundary.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-10-autocompaction-hardening.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

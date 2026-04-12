# Voice-to-Text Composer Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-first voice-to-text input to the chat composer with a mic control, live audio activity bar, explicit stop-to-transcribe flow, append-only draft insertion, per-user engine preference, and English/French/Spanish language support.

**Architecture:** Extend per-user general settings with persisted speech preferences, introduce a client-side speech subsystem with an engine interface plus browser and embedded implementations, and keep the composer declarative by routing microphone state through `ChatView`. The browser engine ships first as the default path, while the embedded engine is a capability-gated implementation slot exposed through the same UI and controller contract.

**Tech Stack:** Next.js 15, React 19, TypeScript, better-sqlite3, Vitest, Testing Library, Playwright, Web Speech API, MediaDevices/AudioContext.

---

## File Structure

### Existing files to modify

- `lib/types.ts`
  Add speech engine and language types and extend `AppSettings`.
- `lib/db.ts`
  Add `stt_engine` and `stt_language` columns to `user_settings`, plus migration/backfill logic.
- `lib/settings.ts`
  Read and write speech settings through `getSettingsForUser`, `getSanitizedSettings`, and `updateGeneralSettingsForUser`.
- `app/api/settings/general/route.ts`
  Accept the speech settings payload fields.
- `components/settings/sections/general-section.tsx`
  Render the STT engine and default language controls and submit them to the existing per-user endpoint.
- `components/chat-composer.tsx`
  Render the mic button, language picker, live activity bar, stop button, and speech error states.
- `components/chat-view.tsx`
  Own draft-append behavior, instantiate the speech controller, and pass the speech props into the composer.
- `tests/unit/settings.test.ts`
  Cover per-user persistence for STT settings.
- `tests/unit/general-section.test.tsx`
  Cover the new settings controls and payload shape.
- `tests/unit/chat-view.test.ts`
  Cover transcript append behavior and composer speech states from the container level.
- `tests/e2e/features.spec.ts`
  Add a mocked browser-dictation happy path.

### New files to create

- `lib/speech/types.ts`
  Shared speech state, engine settings, and session-result types.
- `lib/speech/locales.ts`
  Central mapping from app language (`en`, `fr`, `es`) to browser locales.
- `lib/speech/audio-level-monitor.ts`
  Microphone analyser wrapper that emits normalized audio levels for the live bar.
- `lib/speech/engines/browser-speech-engine.ts`
  Browser-native speech engine implementation using `SpeechRecognition` / `webkitSpeechRecognition`.
- `lib/speech/engines/embedded-speech-engine.ts`
  Capability-gated embedded engine implementation or explicit unsupported stub.
- `lib/speech/create-speech-engine.ts`
  Settings-driven engine selector.
- `lib/speech/speech-controller.ts`
  Session lifecycle coordinator that binds engine selection, audio monitoring, permission handling, and transcript finalization.
- `tests/unit/speech-controller.test.ts`
  Unit coverage for state transitions and engine interaction.
- `tests/unit/browser-speech-engine.test.ts`
  Unit coverage for browser API integration and locale mapping.
- `tests/unit/audio-level-monitor.test.ts`
  Unit coverage for meter normalization and teardown behavior.

## Task 1: Extend Per-User Settings Schema For STT Preferences

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/db.ts`
- Modify: `lib/settings.ts`
- Modify: `app/api/settings/general/route.ts`
- Test: `tests/unit/settings.test.ts`
- Test: `tests/unit/db.test.ts`

- [ ] **Step 1: Write the failing settings persistence test**

```ts
it("stores speech-to-text preferences per user", async () => {
  const alpha = buildProfile({
    id: "profile_alpha",
    name: "Alpha",
    apiKey: "sk-alpha"
  });

  updateSettings({
    defaultProviderProfileId: alpha.id,
    skillsEnabled: false,
    providerProfiles: [alpha]
  });

  const userA = await createLocalUser({ username: "voice-a", password: "changeme123", role: "user" });
  const userB = await createLocalUser({ username: "voice-b", password: "changeme123", role: "user" });

  updateGeneralSettingsForUser(userA.id, {
    sttEngine: "embedded",
    sttLanguage: "fr"
  });
  updateGeneralSettingsForUser(userB.id, {
    sttEngine: "browser",
    sttLanguage: "es"
  });

  expect(getSettingsForUser(userA.id)).toMatchObject({
    sttEngine: "embedded",
    sttLanguage: "fr"
  });
  expect(getSettingsForUser(userB.id)).toMatchObject({
    sttEngine: "browser",
    sttLanguage: "es"
  });
});
```

- [ ] **Step 2: Write the failing DB migration test**

```ts
it("adds speech-to-text columns to user_settings during migration", () => {
  const db = openLegacyDatabase({
    userSettingsColumns: [
      "user_id",
      "default_provider_profile_id",
      "skills_enabled",
      "conversation_retention",
      "auto_compaction",
      "memories_enabled",
      "memories_max_count",
      "mcp_timeout",
      "updated_at"
    ]
  });

  migrate(db);

  const userSettingsColumns = (
    db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>
  ).map((column) => column.name);

  expect(userSettingsColumns).toEqual(
    expect.arrayContaining(["stt_engine", "stt_language"])
  );
});
```

- [ ] **Step 3: Run the targeted tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/db.test.ts
```

Expected:
- FAIL because `AppSettings` does not contain `sttEngine` / `sttLanguage`
- FAIL because `user_settings` has no `stt_engine` / `stt_language` columns

- [ ] **Step 4: Add the new settings types**

```ts
export type SttEngine = "browser" | "embedded";

export type SttLanguage = "en" | "fr" | "es";

export type AppSettings = {
  defaultProviderProfileId: string | null;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  sttEngine: SttEngine;
  sttLanguage: SttLanguage;
  updatedAt: string;
};
```

- [ ] **Step 5: Add DB columns and migration defaults**

```ts
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL PRIMARY KEY,
  default_provider_profile_id TEXT,
  skills_enabled INTEGER NOT NULL DEFAULT 1,
  conversation_retention TEXT NOT NULL DEFAULT 'forever',
  auto_compaction INTEGER NOT NULL DEFAULT 1,
  memories_enabled INTEGER NOT NULL DEFAULT 1,
  memories_max_count INTEGER NOT NULL DEFAULT 100,
  mcp_timeout INTEGER NOT NULL DEFAULT 120000,
  stt_engine TEXT NOT NULL DEFAULT 'browser',
  stt_language TEXT NOT NULL DEFAULT 'en',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (default_provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL
);
```

```ts
const userSettingsCols = db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>;
const userSettingsColNames = userSettingsCols.map((column) => column.name);

if (!userSettingsColNames.includes("stt_engine")) {
  db.exec("ALTER TABLE user_settings ADD COLUMN stt_engine TEXT NOT NULL DEFAULT 'browser'");
}

if (!userSettingsColNames.includes("stt_language")) {
  db.exec("ALTER TABLE user_settings ADD COLUMN stt_language TEXT NOT NULL DEFAULT 'en'");
}
```

- [ ] **Step 6: Thread the new fields through settings reads and writes**

```ts
type UserSettingsRow = {
  user_id: string;
  default_provider_profile_id: string | null;
  skills_enabled: number;
  conversation_retention: string;
  auto_compaction: number;
  memories_enabled: number;
  memories_max_count: number;
  mcp_timeout: number;
  stt_engine: string;
  stt_language: string;
  updated_at: string;
};
```

```ts
function rowToSettings(row: AppSettingsRow | UserSettingsRow): AppSettings {
  return {
    defaultProviderProfileId: row.default_provider_profile_id || null,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention as AppSettings["conversationRetention"],
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    mcpTimeout: row.mcp_timeout,
    sttEngine: (("stt_engine" in row ? row.stt_engine : "browser") || "browser") as AppSettings["sttEngine"],
    sttLanguage: (("stt_language" in row ? row.stt_language : "en") || "en") as AppSettings["sttLanguage"],
    updatedAt: row.updated_at
  };
}
```

```ts
export function updateGeneralSettingsForUser(
  userId: string,
  input: Partial<
    Pick<
      AppSettings,
      "conversationRetention" | "memoriesEnabled" | "memoriesMaxCount" | "mcpTimeout" | "sttEngine" | "sttLanguage"
    >
  >
) {
  const current = getSettingsForUser(userId);
  const next = {
    ...current,
    ...input,
    updatedAt: new Date().toISOString()
  };

  getDb()
    .prepare(
      `UPDATE user_settings
       SET default_provider_profile_id = ?,
           skills_enabled = ?,
           conversation_retention = ?,
           memories_enabled = ?,
           memories_max_count = ?,
           mcp_timeout = ?,
           stt_engine = ?,
           stt_language = ?,
           updated_at = ?
       WHERE user_id = ?`
    )
    .run(
      current.defaultProviderProfileId,
      current.skillsEnabled ? 1 : 0,
      next.conversationRetention,
      next.memoriesEnabled ? 1 : 0,
      next.memoriesMaxCount,
      next.mcpTimeout,
      next.sttEngine,
      next.sttLanguage,
      next.updatedAt,
      userId
    );

  return getSettingsForUser(userId);
}
```

```ts
const generalSettingsSchema = z
  .object({
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]).optional(),
    memoriesEnabled: z.coerce.boolean().optional(),
    memoriesMaxCount: z.coerce.number().int().min(1).max(500).optional(),
    mcpTimeout: z.coerce.number().int().min(10_000).max(600_000).optional(),
    sttEngine: z.enum(["browser", "embedded"]).optional(),
    sttLanguage: z.enum(["en", "fr", "es"]).optional()
  })
  .strip();
```

- [ ] **Step 7: Run the targeted tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/db.test.ts
```

Expected:
- PASS

- [ ] **Step 8: Commit the settings foundation**

```bash
git add lib/types.ts lib/db.ts lib/settings.ts app/api/settings/general/route.ts tests/unit/settings.test.ts tests/unit/db.test.ts
git commit -m "feat: add speech settings persistence"
```

## Task 2: Build The Speech Core And Engine Adapters

**Files:**
- Create: `lib/speech/types.ts`
- Create: `lib/speech/locales.ts`
- Create: `lib/speech/audio-level-monitor.ts`
- Create: `lib/speech/engines/browser-speech-engine.ts`
- Create: `lib/speech/engines/embedded-speech-engine.ts`
- Create: `lib/speech/create-speech-engine.ts`
- Create: `lib/speech/speech-controller.ts`
- Test: `tests/unit/browser-speech-engine.test.ts`
- Test: `tests/unit/audio-level-monitor.test.ts`
- Test: `tests/unit/speech-controller.test.ts`

- [ ] **Step 1: Write the failing browser-engine locale test**

```ts
it("maps app languages to browser recognition locales", () => {
  expect(resolveSpeechLocale("en")).toBe("en-US");
  expect(resolveSpeechLocale("fr")).toBe("fr-FR");
  expect(resolveSpeechLocale("es")).toBe("es-ES");
});
```

- [ ] **Step 2: Write the failing controller lifecycle test**

```ts
it("transitions from listening to transcribing and resolves appended transcript text", async () => {
  const engine = createMockSpeechEngine({
    finalTranscript: "bonjour tout le monde"
  });
  const controller = createSpeechController({
    engine,
    audioMonitor: createMockAudioMonitor()
  });

  await controller.start({ engine: "browser", language: "fr" });
  expect(controller.getSnapshot().phase).toBe("listening");

  const result = await controller.stop();

  expect(result.transcript).toBe("bonjour tout le monde");
  expect(controller.getSnapshot().phase).toBe("idle");
});
```

- [ ] **Step 3: Write the failing audio monitor normalization test**

```ts
it("normalizes analyser data into a 0-1 audio level", () => {
  const analyser = createAnalyserStub([0, 64, 128, 255]);
  const monitor = createAudioLevelMonitor({ analyser });

  expect(monitor.readLevel()).toBeGreaterThan(0);
  expect(monitor.readLevel()).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 4: Run the targeted unit tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/browser-speech-engine.test.ts tests/unit/audio-level-monitor.test.ts tests/unit/speech-controller.test.ts
```

Expected:
- FAIL because the speech modules do not exist yet

- [ ] **Step 5: Create the shared speech types and locale mapping**

```ts
// lib/speech/types.ts
import type { SttEngine, SttLanguage } from "@/lib/types";

export type SpeechPhase =
  | "idle"
  | "requesting-permission"
  | "listening"
  | "transcribing"
  | "error"
  | "unsupported";

export type SpeechSessionSnapshot = {
  phase: SpeechPhase;
  engine: SttEngine;
  language: SttLanguage;
  level: number;
  error: string | null;
};

export type SpeechSessionResult = {
  transcript: string;
};

export type SpeechEngineStartInput = {
  language: SttLanguage;
};

export interface SpeechEngine {
  isSupported(): boolean;
  start(input: SpeechEngineStartInput): Promise<void>;
  stop(): Promise<SpeechSessionResult>;
  dispose(): void;
}
```

```ts
// lib/speech/locales.ts
import type { SttLanguage } from "@/lib/types";

const LOCALE_BY_LANGUAGE: Record<SttLanguage, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES"
};

export function resolveSpeechLocale(language: SttLanguage) {
  return LOCALE_BY_LANGUAGE[language];
}
```

- [ ] **Step 6: Implement the browser and embedded engines**

```ts
// lib/speech/engines/browser-speech-engine.ts
import { resolveSpeechLocale } from "@/lib/speech/locales";
import type { SpeechEngine, SpeechEngineStartInput, SpeechSessionResult } from "@/lib/speech/types";

type BrowserSpeechRecognition = typeof window extends never
  ? never
  : InstanceType<
      new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((event: { error: string }) => void) | null;
        onend: (() => void) | null;
        start(): void;
        stop(): void;
      }
    >;

export class BrowserSpeechEngine implements SpeechEngine {
  private recognition: BrowserSpeechRecognition | null = null;
  private transcript = "";
  private stopPromise: Promise<SpeechSessionResult> | null = null;
  private resolveStop: ((result: SpeechSessionResult) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;

  isSupported() {
    return typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async start(input: SpeechEngineStartInput) {
    const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      throw new Error("Browser speech recognition is unavailable.");
    }

    this.transcript = "";
    this.recognition = new RecognitionCtor();
    this.recognition.lang = resolveSpeechLocale(input.language);
    this.recognition.interimResults = false;
    this.recognition.continuous = true;
    this.stopPromise = new Promise<SpeechSessionResult>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });

    this.recognition.onresult = (event) => {
      this.transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    this.recognition.onerror = (event) => {
      this.rejectStop?.(new Error(event.error || "Speech recognition failed."));
    };
    this.recognition.onend = () => {
      this.resolveStop?.({ transcript: this.transcript });
    };
    this.recognition.start();
  }

  async stop() {
    if (!this.recognition || !this.stopPromise) {
      return { transcript: "" };
    }

    this.recognition.stop();
    return this.stopPromise.finally(() => {
      this.dispose();
    });
  }

  dispose() {
    this.recognition = null;
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
  }
}
```

```ts
// lib/speech/engines/embedded-speech-engine.ts
import type { SpeechEngine, SpeechEngineStartInput, SpeechSessionResult } from "@/lib/speech/types";

export class EmbeddedSpeechEngine implements SpeechEngine {
  isSupported() {
    return false;
  }

  async start(_input: SpeechEngineStartInput) {
    throw new Error("Embedded speech recognition is not available on this device.");
  }

  async stop(): Promise<SpeechSessionResult> {
    return { transcript: "" };
  }

  dispose() {}
}
```

- [ ] **Step 7: Implement the audio monitor and speech controller**

```ts
// lib/speech/audio-level-monitor.ts
export type AudioLevelMonitor = {
  readLevel(): number;
  dispose(): void;
};

export function createAudioLevelMonitor(input: { analyser: AnalyserNode }): AudioLevelMonitor {
  const buffer = new Uint8Array(input.analyser.fftSize);

  return {
    readLevel() {
      input.analyser.getByteTimeDomainData(buffer);
      const peak = buffer.reduce((max, value) => Math.max(max, Math.abs(value - 128)), 0);
      return Math.min(1, peak / 128);
    },
    dispose() {}
  };
}
```

```ts
// lib/speech/create-speech-engine.ts
import type { SttEngine } from "@/lib/types";
import { BrowserSpeechEngine } from "@/lib/speech/engines/browser-speech-engine";
import { EmbeddedSpeechEngine } from "@/lib/speech/engines/embedded-speech-engine";
import type { SpeechEngine } from "@/lib/speech/types";

export function createSpeechEngine(engine: SttEngine): SpeechEngine {
  return engine === "embedded" ? new EmbeddedSpeechEngine() : new BrowserSpeechEngine();
}
```

```ts
// lib/speech/speech-controller.ts
import type { SttEngine, SttLanguage } from "@/lib/types";
import type { SpeechEngine, SpeechSessionResult, SpeechSessionSnapshot } from "@/lib/speech/types";

export function createSpeechController(input: {
  engine: SpeechEngine;
  audioMonitor: { readLevel(): number; dispose(): void };
}) {
  let snapshot: SpeechSessionSnapshot = {
    phase: "idle",
    engine: "browser",
    language: "en",
    level: 0,
    error: null
  };

  return {
    getSnapshot() {
      return {
        ...snapshot,
        level: snapshot.phase === "listening" ? input.audioMonitor.readLevel() : 0
      };
    },
    async start(settings: { engine: SttEngine; language: SttLanguage }) {
      if (!input.engine.isSupported()) {
        snapshot = { ...snapshot, phase: "unsupported", engine: settings.engine, language: settings.language, error: "Selected speech engine is unavailable." };
        throw new Error("Selected speech engine is unavailable.");
      }

      snapshot = { ...snapshot, phase: "requesting-permission", engine: settings.engine, language: settings.language, error: null };
      await input.engine.start({ language: settings.language });
      snapshot = { ...snapshot, phase: "listening", engine: settings.engine, language: settings.language, error: null };
    },
    async stop(): Promise<SpeechSessionResult> {
      snapshot = { ...snapshot, phase: "transcribing" };
      try {
        const result = await input.engine.stop();
        snapshot = { ...snapshot, phase: "idle", level: 0, error: null };
        return result;
      } catch (error) {
        snapshot = {
          ...snapshot,
          phase: "error",
          level: 0,
          error: error instanceof Error ? error.message : "Speech transcription failed."
        };
        throw error;
      }
    },
    dispose() {
      input.engine.dispose();
      input.audioMonitor.dispose();
    }
  };
}
```

- [ ] **Step 8: Run the targeted speech tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/browser-speech-engine.test.ts tests/unit/audio-level-monitor.test.ts tests/unit/speech-controller.test.ts
```

Expected:
- PASS

- [ ] **Step 9: Commit the speech core**

```bash
git add lib/speech tests/unit/browser-speech-engine.test.ts tests/unit/audio-level-monitor.test.ts tests/unit/speech-controller.test.ts
git commit -m "feat: add speech controller and engine adapters"
```

## Task 3: Expose Speech Settings In The General Settings UI

**Files:**
- Modify: `components/settings/sections/general-section.tsx`
- Modify: `tests/unit/general-section.test.tsx`

- [ ] **Step 1: Write the failing settings-form payload test**

```ts
it("saves speech engine and default language through the general settings endpoint", async () => {
  const settings = makeSettings({
    sttEngine: "browser",
    sttLanguage: "en"
  });

  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ settings })
  } as Response);

  render(React.createElement(GeneralSection, { settings }));

  fireEvent.change(screen.getByDisplayValue("Browser"), { target: { value: "embedded" } });
  fireEvent.change(screen.getByDisplayValue("English"), { target: { value: "es" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

  const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
  expect(body).toMatchObject({
    sttEngine: "embedded",
    sttLanguage: "es"
  });
});
```

- [ ] **Step 2: Run the settings-form test to verify it fails**

Run:

```bash
npx vitest run tests/unit/general-section.test.tsx
```

Expected:
- FAIL because the STT controls are not rendered and not included in the payload

- [ ] **Step 3: Add the new settings state and controls**

```tsx
const [sttEngine, setSttEngine] = useState(settings.sttEngine);
const [sttLanguage, setSttLanguage] = useState(settings.sttLanguage);
```

```tsx
<SettingsCard title="Speech-to-Text">
  <SettingRow
    label="Speech engine"
    description="Choose whether dictation uses the browser speech engine or the embedded model path."
  >
    <select
      value={sttEngine}
      onChange={(event) => setSttEngine(event.target.value as AppSettings["sttEngine"])}
      className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30 sm:w-auto"
    >
      <option value="browser">Browser</option>
      <option value="embedded">Embedded model</option>
    </select>
  </SettingRow>

  <SettingRow
    label="Default dictation language"
    description="This is the default language for composer voice input."
  >
    <select
      value={sttLanguage}
      onChange={(event) => setSttLanguage(event.target.value as AppSettings["sttLanguage"])}
      className="w-full rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none transition-all duration-200 focus:border-[var(--accent)]/30 sm:w-auto"
    >
      <option value="en">English</option>
      <option value="fr">French</option>
      <option value="es">Spanish</option>
    </select>
  </SettingRow>
</SettingsCard>
```

```ts
body: JSON.stringify({
  conversationRetention,
  mcpTimeout,
  sttEngine,
  sttLanguage
})
```

- [ ] **Step 4: Run the settings-form test to verify it passes**

Run:

```bash
npx vitest run tests/unit/general-section.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit the settings UI**

```bash
git add components/settings/sections/general-section.tsx tests/unit/general-section.test.tsx
git commit -m "feat: add speech settings controls"
```

## Task 4: Wire Speech Input Into ChatView And ChatComposer

**Files:**
- Modify: `components/chat-composer.tsx`
- Modify: `components/chat-view.tsx`
- Modify: `tests/unit/chat-view.test.ts`

- [ ] **Step 1: Write the failing append-to-draft test**

```ts
it("appends dictated text into the existing draft without sending", async () => {
  renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

  const textarea = screen.getByPlaceholderText(
    "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
  );

  fireEvent.change(textarea, { target: { value: "Existing draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop voice input" }));

  await waitFor(() => {
    expect(textarea).toHaveValue("Existing draft\nbonjour tout le monde");
  });

  expect(wsMock.send).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write the failing unsupported-engine UI test**

```ts
it("shows an inline error when the selected speech engine is unsupported", async () => {
  renderWithProvider(
    React.createElement(ChatView, {
      payload: createPayloadWithSettings({
        sttEngine: "embedded",
        sttLanguage: "en"
      })
    })
  );

  fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));

  await waitFor(() => {
    expect(screen.getByText("Selected speech engine is unavailable.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the chat-view test file to verify it fails**

Run:

```bash
npx vitest run tests/unit/chat-view.test.ts
```

Expected:
- FAIL because the composer exposes no speech controls and `ChatView` has no speech state

- [ ] **Step 4: Extend the composer props and render speech controls**

```ts
type ChatComposerProps = {
  // existing props...
  speechLanguage: "en" | "fr" | "es";
  onSpeechLanguageChange: (language: "en" | "fr" | "es") => void;
  speechPhase: "idle" | "requesting-permission" | "listening" | "transcribing" | "error" | "unsupported";
  speechLevel: number;
  speechError: string | null;
  onStartSpeech: () => void | Promise<void>;
  onStopSpeech: () => void | Promise<void>;
};
```

```tsx
<button
  type="button"
  className={cn(
    "p-2 text-white/30 hover:text-white/70 transition-all duration-200 rounded-xl hover:bg-white/5 shrink-0",
    (speechPhase === "listening" || speechPhase === "transcribing") && "text-emerald-300"
  )}
  aria-label="Start voice input"
  onClick={() => void onStartSpeech()}
  disabled={speechPhase === "requesting-permission" || speechPhase === "transcribing"}
>
  <Mic className="h-4.5 w-4.5" />
</button>
```

```tsx
{speechPhase === "listening" || speechPhase === "transcribing" ? (
  <div className="mx-3 flex min-w-[120px] items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-emerald-400 transition-[width] duration-100"
        style={{ width: `${Math.max(6, Math.round(speechLevel * 100))}%` }}
      />
    </div>
    <button
      type="button"
      aria-label="Stop voice input"
      onClick={() => void onStopSpeech()}
      disabled={speechPhase === "transcribing"}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white"
    >
      <Square className="h-3.5 w-3.5 fill-current" />
    </button>
  </div>
) : null}
```

```tsx
{speechError ? (
  <div className="mx-2 mb-2 rounded-2xl border border-red-400/10 bg-red-500/8 px-3 py-2 text-[11px] text-red-300">
    {speechError}
  </div>
) : null}
```

- [ ] **Step 5: Add speech state management and append behavior in `ChatView`**

```ts
const [speechLanguage, setSpeechLanguage] = useState<AppSettings["sttLanguage"]>(payload.settings.sttLanguage);
const [speechSnapshot, setSpeechSnapshot] = useState<SpeechSessionSnapshot>({
  phase: "idle",
  engine: payload.settings.sttEngine,
  language: payload.settings.sttLanguage,
  level: 0,
  error: null
});
const speechControllerRef = useRef<ReturnType<typeof createSpeechController> | null>(null);
```

```ts
async function handleStartSpeech() {
  const engine = createSpeechEngine(payload.settings.sttEngine);
  const audioMonitor = createAudioLevelMonitor(await createSpeechAudioInput());
  const controller = createSpeechController({ engine, audioMonitor });
  speechControllerRef.current = controller;

  try {
    await controller.start({
      engine: payload.settings.sttEngine,
      language: speechLanguage
    });
    setSpeechSnapshot(controller.getSnapshot());
  } catch (error) {
    setSpeechSnapshot(controller.getSnapshot());
  }
}

async function handleStopSpeech() {
  const controller = speechControllerRef.current;
  if (!controller) return;

  const result = await controller.stop();
  const nextText = result.transcript.trim();

  setSpeechSnapshot(controller.getSnapshot());

  if (!nextText) {
    return;
  }

  setInput((current) => {
    if (!current.trim()) {
      return nextText;
    }
    return `${current.replace(/\s+$/, "")}\n${nextText}`;
  });
}
```

```tsx
<ChatComposer
  // existing props...
  speechLanguage={speechLanguage}
  onSpeechLanguageChange={setSpeechLanguage}
  speechPhase={speechSnapshot.phase}
  speechLevel={speechSnapshot.level}
  speechError={speechSnapshot.error}
  onStartSpeech={handleStartSpeech}
  onStopSpeech={handleStopSpeech}
/>
```

- [ ] **Step 6: Run the chat-view test file to verify it passes**

Run:

```bash
npx vitest run tests/unit/chat-view.test.ts
```

Expected:
- PASS

- [ ] **Step 7: Commit the composer integration**

```bash
git add components/chat-composer.tsx components/chat-view.tsx tests/unit/chat-view.test.ts
git commit -m "feat: add voice input to chat composer"
```

## Task 5: Add End-To-End Coverage For The Browser Speech Happy Path

**Files:**
- Modify: `tests/e2e/features.spec.ts`

- [ ] **Step 1: Write the failing Playwright scenario**

```ts
test("dictates into the composer draft and waits for manual send", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      lang = "en-US";
      interimResults = false;
      continuous = true;
      onresult = null;
      onerror = null;
      onend = null;

      start() {}

      stop() {
        this.onresult?.({
          results: [[{ transcript: "hello from voice input" }]]
        });
        this.onend?.();
      }
    }

    // @ts-expect-error test shim
    window.webkitSpeechRecognition = FakeSpeechRecognition;
    navigator.mediaDevices = {
      ...navigator.mediaDevices,
      getUserMedia: async () => new MediaStream()
    };
  });

  await page.getByRole("button", { name: "Start voice input" }).click();
  await page.getByRole("button", { name: "Stop voice input" }).click();

  await expect(
    page.getByPlaceholder("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break...")
  ).toHaveValue("hello from voice input");

  await expect(page.getByText("Attachment received")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the Playwright spec to verify it fails**

Run:

```bash
npx playwright test tests/e2e/features.spec.ts --grep "dictates into the composer draft"
```

Expected:
- FAIL because the mic controls do not exist yet or the browser speech path is not wired

- [ ] **Step 3: Adjust accessibility labels and browser hooks as needed for the test**

```tsx
<button
  type="button"
  aria-label="Start voice input"
  // ...
>
  <Mic className="h-4.5 w-4.5" />
</button>
```

```tsx
<button
  type="button"
  aria-label="Stop voice input"
  // ...
>
  <Square className="h-3.5 w-3.5 fill-current" />
</button>
```

- [ ] **Step 4: Re-run the Playwright speech test to verify it passes**

Run:

```bash
npx playwright test tests/e2e/features.spec.ts --grep "dictates into the composer draft"
```

Expected:
- PASS

- [ ] **Step 5: Commit the browser-level test coverage**

```bash
git add tests/e2e/features.spec.ts components/chat-composer.tsx
git commit -m "test: cover browser speech composer flow"
```

## Task 6: Run Full Verification And Manual UI Validation

**Files:**
- No code changes expected

- [ ] **Step 1: Run the focused unit and e2e verification suite**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/db.test.ts tests/unit/general-section.test.tsx tests/unit/browser-speech-engine.test.ts tests/unit/audio-level-monitor.test.ts tests/unit/speech-controller.test.ts tests/unit/chat-view.test.ts
npx playwright test tests/e2e/features.spec.ts --grep "dictates into the composer draft"
```

Expected:
- PASS

- [ ] **Step 2: Start or reuse the dev server for manual validation**

Run:

```bash
if [ -f .dev-server ]; then
  cat .dev-server
else
  npm run dev
fi
```

Expected:
- A local URL from `.dev-server`, such as `http://localhost:3127`

- [ ] **Step 3: Validate the UI in the browser with the required skill**

Run:

```bash
cat .dev-server
```

Then use the required browser workflow:
- open the chat page
- verify the mic control is visible in the composer
- start recording and confirm the live meter appears
- stop recording and confirm the transcript appends into the draft
- verify the message is not auto-sent
- open settings and confirm engine/language preferences save correctly
- capture screenshots of the chat composer recording state and the general settings speech section

- [ ] **Step 4: Run typecheck and lint before handoff**

Run:

```bash
npm run typecheck
npm run lint
```

Expected:
- PASS

- [ ] **Step 5: Commit the final verified state**

```bash
git add .
git commit -m "feat: add local-first voice-to-text input"
```

## Self-Review

### Spec coverage

- Mic affordance in composer: covered by Task 4.
- Live audio activity bar: covered by Task 4 plus Task 2 audio monitor work.
- Stop-to-transcribe flow with no auto-send: covered by Task 4 and Task 5.
- Browser default plus embedded engine preference: covered by Task 1, Task 2, and Task 3.
- English/French/Spanish language support: covered by Task 1, Task 2, Task 3, and Task 4.
- Explicit unsupported and permission errors: covered by Task 2 and Task 4.
- Browser validation and screenshots: covered by Task 6.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Each code-changing task includes concrete code and exact commands.
- Every test step identifies a concrete file and expected failure/pass outcome.

### Type consistency

- Settings types use `sttEngine` and `sttLanguage` consistently across types, storage, API, and UI.
- Speech phases are defined once in `lib/speech/types.ts` and consumed consistently by controller and composer.
- Locale mapping uses the same `en | fr | es` language enum defined in `lib/types.ts`.

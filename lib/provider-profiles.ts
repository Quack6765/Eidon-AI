import { z } from "zod";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { getGlobalPreferences, updateGlobalPreferences } from "@/lib/global-preferences";
import {
  PROVIDER_CATALOG,
  PROVIDER_PRESETS,
  type ProviderPresetId,
  type ReasoningEffort,
  type VisionMode
} from "@/lib/provider-catalog";
import {
  getProviderApiMode,
  isProviderKind,
  toProviderProfileSummary,
  type ProviderConnectionMetadata,
  type ProviderCredentials,
  type ProviderProfile,
  type RuntimeProviderProfile
} from "@/lib/provider-profile";
import { supportsImageInput } from "@/lib/model-capabilities";

export const secretActionSchema = z.enum(["preserve", "replace", "clear"]);
export type SecretAction = z.infer<typeof secretActionSchema>;

const commonProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  model: z.string(),
  systemPrompt: z.string(),
  temperature: z.coerce.number().min(0).max(2),
  maxOutputTokens: z.coerce.number().int().min(128),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  reasoningSummaryEnabled: z.coerce.boolean(),
  modelContextLimit: z.coerce.number().int().min(4096).max(2_000_000),
  compactionThreshold: z.coerce.number().min(0.5).max(0.95),
  freshTailCount: z.coerce.number().int().min(8).max(128),
  tokenizerModel: z.enum(["gpt-tokenizer", "off"]),
  safetyMarginTokens: z.coerce.number().int().min(128).max(32768),
  leafSourceTokenLimit: z.coerce.number().int().min(1000).max(100000),
  leafMinMessageCount: z.coerce.number().int().min(2).max(50),
  mergedMinNodeCount: z.coerce.number().int().min(2).max(20),
  mergedTargetTokens: z.coerce.number().int().min(128).max(16000),
  visionMode: z.enum(["none", "native", "mcp", "provider"]),
  visionProviderProfileId: z.string().min(1).nullable().default(null),
  providerPresetId: z.enum(
    PROVIDER_PRESETS.map((preset) => preset.id) as [
      ProviderPresetId,
      ...ProviderPresetId[]
    ]
  ).nullable(),
  credential: z.string().optional(),
  credentialAction: secretActionSchema.optional()
});

export const providerProfileInputSchema = z.discriminatedUnion("providerKind", [
  commonProfileSchema.extend({
    providerKind: z.literal("openai_compatible"),
    providerConfig: z.object({
      apiBaseUrl: z.string().url(),
      apiMode: z.enum(["responses", "chat_completions"]),
      processingMode: z.enum(["standard", "fast"]).default("standard"),
      reasoningParameterMode: z.enum(["standard", "mirrored"]).default("standard")
    })
  }),
  commonProfileSchema.extend({
    providerKind: z.literal("anthropic"),
    providerConfig: z.object({ apiBaseUrl: z.string().url() })
  }),
  commonProfileSchema.extend({
    providerKind: z.literal("github_copilot"),
    providerConfig: z.object({}).strict()
  })
]).superRefine((value, context) => {
  if (value.providerKind !== "github_copilot" && !value.model.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["model"],
      message: "Model is required"
    });
  }
  if (value.maxOutputTokens + value.safetyMarginTokens >= value.modelContextLimit) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxOutputTokens"],
      message: "Output tokens plus the safety margin must be below the context limit"
    });
  }
});

export const providerCatalogInputSchema = z.object({
  defaultProviderProfileId: z.string().min(1),
  skillsEnabled: z.coerce.boolean(),
  conversationRetention: z.enum(["forever", "90d", "30d", "7d"]),
  memoriesEnabled: z.coerce.boolean(),
  memoriesMaxCount: z.coerce.number().int().min(1).max(500),
  mcpTimeout: z.coerce.number().int().min(10_000).max(600_000),
  providerProfiles: z.array(providerProfileInputSchema).min(1)
}).superRefine((value, context) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  value.providerProfiles.forEach((profile, index) => {
    const normalizedName = profile.name.toLowerCase();
    if (ids.has(profile.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerProfiles", index, "id"],
        message: "Provider profile ids must be unique"
      });
    }
    if (names.has(normalizedName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerProfiles", index, "name"],
        message: "Provider profile names must be unique"
      });
    }
    ids.add(profile.id);
    names.add(normalizedName);
    if (profile.visionMode === "provider") {
      if (!profile.visionProviderProfileId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providerProfiles", index, "visionProviderProfileId"],
          message: "Vision provider profile is required when vision mode is provider"
        });
      } else if (profile.visionProviderProfileId === profile.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providerProfiles", index, "visionProviderProfileId"],
          message: "Vision provider profile must reference a different profile"
        });
      } else {
        const target = value.providerProfiles.find(
          (candidate) => candidate.id === profile.visionProviderProfileId
        );
        if (!target) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["providerProfiles", index, "visionProviderProfileId"],
            message: "Vision provider profile must reference a profile saved in this catalog"
          });
        } else if (!supportsImageInput(target.model, getProviderApiMode(target))) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["providerProfiles", index, "visionProviderProfileId"],
            message: `Vision provider profile model "${target.model}" does not support image input`
          });
        }
      }
    }
  });
  if (!ids.has(value.defaultProviderProfileId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultProviderProfileId"],
      message: "Default provider profile must match a saved profile"
    });
  }
});

export type ProviderProfileInput = z.infer<typeof providerProfileInputSchema>;

type ProviderProfileRow = {
  id: string;
  name: string;
  provider_kind: string;
  provider_config_json: string;
  model: string;
  system_prompt: string;
  temperature: number;
  max_output_tokens: number;
  reasoning_effort: ReasoningEffort;
  reasoning_summary_enabled: number;
  model_context_limit: number;
  compaction_threshold: number;
  fresh_tail_count: number;
  tokenizer_model: string;
  safety_margin_tokens: number;
  leaf_source_token_limit: number;
  leaf_min_message_count: number;
  merged_min_node_count: number;
  merged_target_tokens: number;
  vision_mode: string;
  vision_provider_profile_id: string | null;
  provider_preset_id: string | null;
  created_at: string;
  updated_at: string;
  credentials_encrypted: string;
  metadata_json: string;
  oauth_nonce: string | null;
};

const PROFILE_COLUMNS = `
  p.id, p.name, p.provider_kind, p.provider_config_json, p.model,
  p.system_prompt, p.temperature, p.max_output_tokens, p.reasoning_effort,
  p.reasoning_summary_enabled, p.model_context_limit, p.compaction_threshold,
  p.fresh_tail_count, p.tokenizer_model, p.safety_margin_tokens,
  p.leaf_source_token_limit, p.leaf_min_message_count, p.merged_min_node_count,
  p.merged_target_tokens, p.vision_mode, p.vision_provider_profile_id, p.provider_preset_id,
  p.created_at, p.updated_at,
  COALESCE(c.credentials_encrypted, '') AS credentials_encrypted,
  COALESCE(c.metadata_json, '{}') AS metadata_json,
  c.oauth_nonce
`;

function parseObject<T extends object>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as T
      : fallback;
  } catch {
    return fallback;
  }
}

function decryptCredentials(value: string): ProviderCredentials {
  if (!value) return {};
  try {
    return parseObject<ProviderCredentials>(decryptValue(value), {});
  } catch {
    return {};
  }
}

function rowToRuntimeProfile(row: ProviderProfileRow): RuntimeProviderProfile {
  const providerKind = isProviderKind(row.provider_kind)
    ? row.provider_kind
    : "openai_compatible";
  const rawConfig = parseObject<Record<string, unknown>>(row.provider_config_json, {});
  const common = {
    id: row.id,
    name: row.name,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    reasoningEffort: row.reasoning_effort,
    reasoningSummaryEnabled: Boolean(row.reasoning_summary_enabled),
    modelContextLimit: row.model_context_limit,
    compactionThreshold: row.compaction_threshold,
    freshTailCount: row.fresh_tail_count,
    tokenizerModel: row.tokenizer_model as "gpt-tokenizer" | "off",
    safetyMarginTokens: row.safety_margin_tokens,
    leafSourceTokenLimit: row.leaf_source_token_limit,
    leafMinMessageCount: row.leaf_min_message_count,
    mergedMinNodeCount: row.merged_min_node_count,
    mergedTargetTokens: row.merged_target_tokens,
    visionMode: row.vision_mode as VisionMode,
    visionProviderProfileId: row.vision_provider_profile_id ?? null,
    providerPresetId: row.provider_preset_id as ProviderPresetId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    credentials: decryptCredentials(row.credentials_encrypted),
    connectionMetadata: parseObject<ProviderConnectionMetadata>(row.metadata_json, {})
  };

  if (providerKind === "github_copilot") {
    return { ...common, providerKind, providerConfig: {} };
  }
  if (providerKind === "anthropic") {
    return {
      ...common,
      providerKind,
      providerConfig: { apiBaseUrl: String(rawConfig.apiBaseUrl ?? "") }
    };
  }
  return {
    ...common,
    providerKind,
    providerConfig: {
      apiBaseUrl: String(rawConfig.apiBaseUrl ?? ""),
      apiMode: rawConfig.apiMode === "chat_completions" ? "chat_completions" : "responses",
      processingMode: rawConfig.processingMode === "fast" ? "fast" : "standard",
      reasoningParameterMode: rawConfig.reasoningParameterMode === "mirrored"
        ? "mirrored"
        : "standard"
    }
  };
}

function listRows() {
  return getDb().prepare(`
    SELECT ${PROFILE_COLUMNS}
    FROM provider_profiles p
    LEFT JOIN provider_profile_connections c ON c.profile_id = p.id
    ORDER BY p.created_at ASC
  `).all() as ProviderProfileRow[];
}

function getRow(profileId: string) {
  return getDb().prepare(`
    SELECT ${PROFILE_COLUMNS}
    FROM provider_profiles p
    LEFT JOIN provider_profile_connections c ON c.profile_id = p.id
    WHERE p.id = ?
  `).get(profileId) as ProviderProfileRow | undefined;
}

export function listRuntimeProviderProfiles() {
  return listRows().map(rowToRuntimeProfile);
}

export function listProviderProfiles(): ProviderProfile[] {
  return listRuntimeProviderProfiles().map((profile) => {
    const { credentials: _credentials, connectionMetadata: _metadata, ...stored } = profile;
    return stored;
  });
}

export function listProviderProfileSummaries() {
  return listRuntimeProviderProfiles().map(toProviderProfileSummary);
}

export function getProviderProfile(profileId: string) {
  const row = getRow(profileId);
  if (!row) return null;
  const { credentials: _credentials, connectionMetadata: _metadata, ...profile } = rowToRuntimeProfile(row);
  return profile;
}

export function getRuntimeProviderProfile(profileId: string) {
  const row = getRow(profileId);
  return row ? rowToRuntimeProfile(row) : null;
}

function getDefaultProviderId() {
  return getGlobalPreferences().defaultProviderProfileId;
}

export function getDefaultProviderProfile() {
  const id = getDefaultProviderId();
  return id ? getProviderProfile(id) : null;
}

export function getDefaultRuntimeProviderProfile() {
  const id = getDefaultProviderId();
  return id ? getRuntimeProviderProfile(id) : null;
}

function encryptedCredentials(credentials: ProviderCredentials) {
  const compact = Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => Boolean(value))
  );
  return Object.keys(compact).length ? encryptValue(JSON.stringify(compact)) : "";
}

export function updateProviderConnection(
  profileId: string,
  input: {
    credentials: ProviderCredentials;
    metadata?: ProviderConnectionMetadata;
    oauthNonce?: string | null;
  }
) {
  const profile = getProviderProfile(profileId);
  if (!profile) return false;
  const timestamp = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO provider_profile_connections (
      profile_id, credentials_encrypted, metadata_json,
      oauth_nonce, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      credentials_encrypted = excluded.credentials_encrypted,
      metadata_json = excluded.metadata_json,
      oauth_nonce = excluded.oauth_nonce,
      updated_at = excluded.updated_at
  `).run(
    profileId,
    encryptedCredentials(input.credentials),
    JSON.stringify(input.metadata ?? {}),
    input.oauthNonce ?? null,
    timestamp,
    timestamp
  );
  return true;
}

export function claimProviderConnectionAttempt(profileId: string) {
  const profile = getProviderProfile(profileId);
  if (!profile || PROVIDER_CATALOG[profile.providerKind].connectionMode !== "oauth") return null;
  const nonce = crypto.randomUUID();
  const result = getDb().prepare(`
    UPDATE provider_profile_connections
    SET oauth_nonce = ?, updated_at = ?
    WHERE profile_id = ?
  `).run(nonce, new Date().toISOString(), profileId);
  return result.changes === 1 ? nonce : null;
}

export function updateProviderConnectionIfNonceMatches(
  profileId: string,
  nonce: string,
  input: { credentials: ProviderCredentials; metadata?: ProviderConnectionMetadata }
) {
  const profile = getProviderProfile(profileId);
  if (!profile) return false;
  const result = getDb().prepare(`
    UPDATE provider_profile_connections
    SET credentials_encrypted = ?, metadata_json = ?, oauth_nonce = NULL, updated_at = ?
    WHERE profile_id = ? AND oauth_nonce = ?
  `).run(
    encryptedCredentials(input.credentials),
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
    profileId,
    nonce
  );
  return result.changes === 1;
}

export function updateProviderConnectionIfRefreshTokenMatches(
  profileId: string,
  refreshToken: string,
  input: { credentials: ProviderCredentials; metadata?: ProviderConnectionMetadata }
) {
  const current = getRuntimeProviderProfile(profileId);
  if (!current || current.credentials.refreshToken !== refreshToken) return false;
  return updateProviderConnection(profileId, input);
}

export function clearProviderConnection(profileId: string) {
  const profile = getProviderProfile(profileId);
  if (!profile) return false;
  return updateProviderConnection(profileId, { credentials: {}, metadata: {} });
}

function providerConfigJson(profile: ProviderProfile) {
  return JSON.stringify(profile.providerConfig);
}

function providerConnectionIdentity(profile: ProviderProfile) {
  return profile.providerKind === "github_copilot"
    ? profile.providerKind
    : `${profile.providerKind}:${profile.providerConfig.apiBaseUrl}`;
}

export function duplicateProviderProfileRecord(sourceProfileId: string) {
  const source = getRuntimeProviderProfile(sourceProfileId);
  if (!source) throw new Error("Provider profile not found");
  const existingNames = new Set(
    listProviderProfiles().map((profile) => profile.name.trim().toLowerCase())
  );
  let name = `${source.name} copy`;
  let suffix = 2;
  while (existingNames.has(name.toLowerCase())) name = `${source.name} copy ${suffix++}`;
  const id = `profile_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  const insert = getDb().transaction(() => {
    insertProfile({ ...source, id, name, createdAt: timestamp, updatedAt: timestamp });
    updateProviderConnection(id, {
      credentials: PROVIDER_CATALOG[source.providerKind].connectionMode === "api_key"
        ? source.credentials
        : {},
      metadata: {}
    });
  });
  insert();
  return getProviderProfile(id)!;
}

function insertProfile(profile: ProviderProfile) {
  getDb().prepare(`
    INSERT INTO provider_profiles (
      id, name, provider_kind, provider_config_json, model, system_prompt,
      temperature, max_output_tokens, reasoning_effort,
      reasoning_summary_enabled, model_context_limit, compaction_threshold,
      fresh_tail_count, tokenizer_model, safety_margin_tokens,
      leaf_source_token_limit, leaf_min_message_count, merged_min_node_count,
      merged_target_tokens, vision_mode, vision_provider_profile_id, provider_preset_id, created_at, updated_at
    ) VALUES (
      @id, @name, @providerKind, @providerConfigJson, @model, @systemPrompt,
      @temperature, @maxOutputTokens, @reasoningEffort,
      @reasoningSummaryEnabled, @modelContextLimit, @compactionThreshold,
      @freshTailCount, @tokenizerModel, @safetyMarginTokens,
      @leafSourceTokenLimit, @leafMinMessageCount, @mergedMinNodeCount,
      @mergedTargetTokens, @visionMode, @visionProviderProfileId, @providerPresetId, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider_kind = excluded.provider_kind,
      provider_config_json = excluded.provider_config_json,
      model = excluded.model,
      system_prompt = excluded.system_prompt,
      temperature = excluded.temperature,
      max_output_tokens = excluded.max_output_tokens,
      reasoning_effort = excluded.reasoning_effort,
      reasoning_summary_enabled = excluded.reasoning_summary_enabled,
      model_context_limit = excluded.model_context_limit,
      compaction_threshold = excluded.compaction_threshold,
      fresh_tail_count = excluded.fresh_tail_count,
      tokenizer_model = excluded.tokenizer_model,
      safety_margin_tokens = excluded.safety_margin_tokens,
      leaf_source_token_limit = excluded.leaf_source_token_limit,
      leaf_min_message_count = excluded.leaf_min_message_count,
      merged_min_node_count = excluded.merged_min_node_count,
      merged_target_tokens = excluded.merged_target_tokens,
      vision_mode = excluded.vision_mode,
      vision_provider_profile_id = excluded.vision_provider_profile_id,
      provider_preset_id = excluded.provider_preset_id,
      updated_at = excluded.updated_at
  `).run({
    ...profile,
    providerConfigJson: providerConfigJson(profile),
    reasoningSummaryEnabled: profile.reasoningSummaryEnabled ? 1 : 0
  });
}

function normalizeRemovedVisionReferences(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const catalog = input as Record<string, unknown>;
  const rawProfiles = catalog.providerProfiles;
  if (!Array.isArray(rawProfiles)) return input;
  const incomingIds = new Set(
    rawProfiles
      .filter((profile): profile is Record<string, unknown> =>
        typeof profile === "object" && profile !== null)
      .map((profile) => profile.id)
  );
  const normalizedProfiles = rawProfiles.map((profile) => {
    if (typeof profile !== "object" || profile === null) return profile;
    const record = profile as Record<string, unknown>;
    const reference = record.visionProviderProfileId;
    if (typeof reference !== "string" || !reference || incomingIds.has(reference)) {
      return profile;
    }
    return { ...record, visionProviderProfileId: null, visionMode: "none" };
  });
  return { ...catalog, providerProfiles: normalizedProfiles };
}

export function saveProviderCatalog(input: unknown) {
  const parsed = providerCatalogInputSchema.parse(normalizeRemovedVisionReferences(input));
  const current = new Map(listRuntimeProviderProfiles().map((profile) => [profile.id, profile]));
  const incomingIds = new Set(parsed.providerProfiles.map((profile) => profile.id));
  const removedIds = [...current.keys()].filter((id) => !incomingIds.has(id));
  const timestamp = new Date().toISOString();

  const transaction = getDb().transaction(() => {
    for (const profileInput of parsed.providerProfiles) {
      const previous = current.get(profileInput.id);
      const profile = {
        ...profileInput,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp
      } as ProviderProfile;
      const identityChanged = Boolean(
        previous && (
          providerConnectionIdentity(previous) !== providerConnectionIdentity(profile)
        )
      );
      const action = profileInput.credentialAction ?? (
        profileInput.credential?.trim()
          ? "replace"
          : identityChanged
            ? "clear"
            : "preserve"
      );
      if (action === "replace" && !profileInput.credential?.trim()) {
        throw new Error(`Provider ${profile.name} requires a credential when replacing it`);
      }
      if (action === "preserve" && identityChanged && previous?.credentials.apiKey) {
        throw new Error(`Provider ${profile.name} changed connection identity; replace or clear its credential`);
      }
      insertProfile(profile);

      const credentials = action === "preserve"
        ? previous?.credentials ?? {}
        : action === "replace"
          ? { apiKey: profileInput.credential!.trim() }
          : {};
      const preserveOauth =
        previous &&
        previous.providerKind === profile.providerKind &&
        PROVIDER_CATALOG[profile.providerKind].connectionMode === "oauth";
      updateProviderConnection(profile.id, {
        credentials: preserveOauth ? previous.credentials : credentials,
        metadata: preserveOauth ? previous.connectionMetadata : {},
        oauthNonce: preserveOauth ? getRow(profile.id)?.oauth_nonce ?? null : null
      });
    }

    if (removedIds.length) {
      const placeholders = removedIds.map(() => "?").join(", ");
      getDb().prepare(`
        UPDATE conversations SET provider_profile_id = ?
        WHERE provider_profile_id IN (${placeholders})
      `).run(parsed.defaultProviderProfileId, ...removedIds);
      getDb().prepare(`
        UPDATE automations SET provider_profile_id = ?, updated_at = ?
        WHERE provider_profile_id IN (${placeholders})
      `).run(parsed.defaultProviderProfileId, timestamp, ...removedIds);
      const preferences = getGlobalPreferences();
      if (preferences.titleGenerationProfileId && removedIds.includes(preferences.titleGenerationProfileId)) {
        updateGlobalPreferences({
          titleGenerationMode: "same",
          titleGenerationProfileId: null
        });
      }
      getDb().prepare(`DELETE FROM provider_profiles WHERE id IN (${placeholders})`).run(...removedIds);
    }

    updateGlobalPreferences({
      defaultProviderProfileId: parsed.defaultProviderProfileId,
      skillsEnabled: parsed.skillsEnabled,
      conversationRetention: parsed.conversationRetention,
      memoriesEnabled: parsed.memoriesEnabled,
      memoriesMaxCount: parsed.memoriesMaxCount,
      mcpTimeout: parsed.mcpTimeout
    });
  });
  transaction();
  return parsed;
}

import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";

const vendorPattern = /github|copilot|google|assemblyai|elevenlabs|\bexa\b|tavily|searxng|openai|anthropic|claude|gemini|ollama|comfyui/i;

const allowedVendorPaths = new Set([
  "app/api/providers/github/callback/route.ts",
  "components/settings/integration-settings/image-generation-settings.tsx",
  "components/settings/integration-settings/web-search-settings.tsx",
  "components/settings/provider-connection-fields.tsx",
  "lib/anthropic.ts",
  "lib/copilot-tools.ts",
  "lib/db-migrations.ts",
  "lib/env.ts",
  "lib/github-copilot.ts",
  "lib/image-generation/catalog.ts",
  "lib/image-generation/google-nano-banana.ts",
  "lib/image-generation/provider.ts",
  "lib/model-registry.ts",
  "lib/provider-catalog.ts",
  "lib/provider-profile-editor.ts",
  "lib/provider-profile.ts",
  "lib/provider-profiles.ts",
  "lib/readme-demo.ts",
  "lib/searxng.ts",
  "lib/speech/assemblyai-languages.ts",
  "lib/speech/assemblyai.ts",
  "lib/speech/elevenlabs-languages.ts",
  "lib/speech/elevenlabs.ts",
  "lib/speech/external-providers.ts",
  "lib/speech/external-transcription.ts",
  "lib/speech/transcription-catalog.ts",
  "lib/speech/transcription-providers.ts",
  "lib/web-search-catalog.ts",
  "lib/web-search.ts"
]);

const allowedVendorPathPrefixes = ["lib/provider-adapters/"];

const allowedSharedLines: Record<string, RegExp[]> = {
  "app/layout.tsx": [/next\/font\/google/],
  "components/shared-conversation-view.tsx": [/github\.com\/Quack6765\/Eidon-AI/],
  "lib/markdown/formatting-rules-prompt.ts": [/GitHub (?:Flavored Markdown|pipe tables|alert\/admonition blocks)/],
  "lib/mobile-api.ts": [
    /"comfyuiBearerToken"/,
    /"github(?:RefreshToken|RefreshTokenEncrypted|UserAccessToken|UserAccessTokenEncrypted)"/,
    /"googleNanoBananaApiKey"/,
    /"tavilyApiKey"/
  ]
};

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx|cjs)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("vendor boundaries", () => {
  it("keeps vendor terminology inside the explicit adapter and configuration allowlist", () => {
    const roots = ["app", "components", "hooks", "lib"]
      .flatMap((directory) => sourceFiles(path.resolve(directory)));
    const unexpected = roots.flatMap((file) => {
      const relativePath = path.relative(process.cwd(), file);
      if (
        allowedVendorPaths.has(relativePath) ||
        allowedVendorPathPrefixes.some((prefix) => relativePath.startsWith(prefix))
      ) {
        return [];
      }

      return fs.readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => {
          if (!vendorPattern.test(line)) return [];
          if ((allowedSharedLines[relativePath] ?? []).some((pattern) => pattern.test(line))) {
            return [];
          }
          return [`${relativePath}:${index + 1}: ${line.trim()}`];
        });
    });

    expect(unexpected).toEqual([]);
  });

  it("keeps vendor-specific fields out of public DTOs and contracts", () => {
    const publicSources = [
      "lib/types.ts",
      "lib/provider-profile.ts",
      "contracts/mobile-api-v1.openapi.json"
    ].map((file) => fs.readFileSync(path.resolve(file), "utf8"));
    const vendorFieldPattern = /github(?:UserAccess|Refresh|Account|Token|Connection)|assemblyAiApiKey|googleNanoBananaApiKey|elevenLabsApiKey|exaApiKey|tavilyApiKey|searxngBaseUrl/i;

    for (const source of publicSources) expect(source).not.toMatch(vendorFieldPattern);
  });

  it("keeps shared transcription behavior on generic provider capabilities", () => {
    const sharedSources = [
      "lib/speech/transcription-catalog.ts",
      "lib/speech/transcription-providers.ts"
    ].map((file) => fs.readFileSync(path.resolve(file), "utf8"));

    for (const source of sharedSources) {
      expect(source).not.toMatch(/from "@\/lib\/speech\/(?:assemblyai|elevenlabs)-languages"/);
      expect(source).not.toMatch(/\b(?:AssemblyAi|ElevenLabsScribe)(?:Language|Model)/);
    }
  });

  it("keeps vendor-specific columns out of steady-state core tables", () => {
    const tables = [
      "provider_profiles",
      "provider_profile_connections",
      "provider_connection_flows",
      "integration_settings",
      "global_preferences",
      "user_preferences"
    ];
    const columns = tables.flatMap((table) =>
      (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map(({ name }) => `${table}.${name}`)
    );

    expect(columns.filter((column) => vendorPattern.test(column))).toEqual([]);
  });
});

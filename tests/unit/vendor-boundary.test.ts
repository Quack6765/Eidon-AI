import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";

const vendorPattern = /github|google|elevenlabs|\bexa\b|tavily|searxng/i;

const allowedVendorPaths = new Set([
  "app/api/providers/github/callback/route.ts",
  "app/api/providers/github/connect/route.ts",
  "app/layout.tsx",
  "components/settings/sections/general-section.tsx",
  "components/settings/sections/providers-section.tsx",
  "components/shared-conversation-view.tsx",
  "lib/copilot-tools.ts",
  "lib/db-migrations.ts",
  "lib/env.ts",
  "lib/github-copilot.ts",
  "lib/image-generation/google-nano-banana.ts",
  "lib/image-generation/provider.ts",
  "lib/integration-settings.ts",
  "lib/markdown/formatting-rules-prompt.ts",
  "lib/mobile-api.ts",
  "lib/mobile-github-oauth.ts",
  "lib/provider-adapters/github-copilot.ts",
  "lib/provider-adapters/index.ts",
  "lib/provider-catalog.ts",
  "lib/provider-profile.ts",
  "lib/provider-profiles.ts",
  "lib/readme-demo.ts",
  "lib/searxng.ts",
  "lib/speech/elevenlabs-languages.ts",
  "lib/speech/elevenlabs.ts",
  "lib/speech/external-providers.ts",
  "lib/speech/external-transcription.ts",
  "lib/speech/transcription-providers.ts",
  "lib/types.ts",
  "lib/web-search.ts"
]);

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
    const unexpected = roots
      .filter((file) => vendorPattern.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(process.cwd(), file))
      .filter((file) => !allowedVendorPaths.has(file));

    expect(unexpected).toEqual([]);
  });

  it("keeps vendor-specific fields out of public DTOs and contracts", () => {
    const publicSources = [
      "lib/types.ts",
      "lib/provider-profile.ts",
      "contracts/mobile-api-v1.openapi.json"
    ].map((file) => fs.readFileSync(path.resolve(file), "utf8"));
    const vendorFieldPattern = /github(?:UserAccess|Refresh|Account|Token|Connection)|googleNanoBananaApiKey|elevenLabsApiKey|exaApiKey|tavilyApiKey|searxngBaseUrl/i;

    for (const source of publicSources) expect(source).not.toMatch(vendorFieldPattern);
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

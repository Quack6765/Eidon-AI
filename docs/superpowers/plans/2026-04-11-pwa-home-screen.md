# PWA Home Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a basic installable PWA shell and replace the current assistant avatar with a better warrior-face crop derived from the existing banner artwork.

**Architecture:** Keep installability concerns in the app shell and keep icon generation isolated in a small Sharp-based asset pipeline. Generate one shared portrait source from `public/eidon-banner.png`, derive the install icons and the in-app avatar from that source, then wire the manifest and metadata through the Next app router.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Sharp, Testing Library

---

## File Structure

- Create: `lib/warrior-icon-assets.ts`
  Responsible for deterministic icon generation from `public/eidon-banner.png`.
- Create: `scripts/generate-warrior-icons.ts`
  CLI entrypoint that writes generated assets into `public/`.
- Modify: `package.json`
  Adds a dedicated asset-generation script.
- Create: `app/manifest.ts`
  Typed Next metadata route for `/manifest.webmanifest`.
- Modify: `app/layout.tsx`
  Declares manifest, install icons, Apple metadata, and viewport theme color.
- Modify: `components/message-bubble.tsx`
  Replaces `/chat-icon.png` with the new generated assistant avatar.
- Create: `tests/unit/warrior-icon-assets.test.ts`
  Verifies the generation helper emits the expected files and dimensions.
- Create: `tests/unit/pwa-metadata.test.ts`
  Verifies the manifest and root metadata expose the install configuration.
- Create: `tests/unit/message-bubble.test.tsx`
  Verifies assistant bubbles reference the new avatar asset.
- Create/generated: `public/warrior-portrait.png`
- Create/generated: `public/agent-icon.png`
- Create/generated: `public/icon-192.png`
- Create/generated: `public/icon-512.png`
- Create/generated: `public/apple-touch-icon.png`

## Task 1: Build the Warrior Icon Asset Pipeline

**Files:**
- Create: `lib/warrior-icon-assets.ts`
- Create: `scripts/generate-warrior-icons.ts`
- Modify: `package.json`
- Test: `tests/unit/warrior-icon-assets.test.ts`

- [ ] **Step 1: Write the failing asset-generation test**

```ts
// tests/unit/warrior-icon-assets.test.ts
import os from "node:os";
import path from "node:path";
import { mkdtemp, stat } from "node:fs/promises";

import sharp from "sharp";

import { generateWarriorIconAssets } from "@/lib/warrior-icon-assets";

describe("generateWarriorIconAssets", () => {
  it("creates the portrait, avatar, and install icons from the banner artwork", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "eidon-warrior-icons-"));

    await generateWarriorIconAssets({
      sourcePath: path.join(process.cwd(), "public/eidon-banner.png"),
      outputDir
    });

    const expectedAssets = [
      { name: "warrior-portrait.png", width: 512, height: 512 },
      { name: "agent-icon.png", width: 128, height: 128 },
      { name: "icon-192.png", width: 192, height: 192 },
      { name: "icon-512.png", width: 512, height: 512 },
      { name: "apple-touch-icon.png", width: 180, height: 180 }
    ];

    for (const asset of expectedAssets) {
      const filePath = path.join(outputDir, asset.name);
      await expect(stat(filePath)).resolves.toBeDefined();
      const metadata = await sharp(filePath).metadata();
      expect(metadata.width).toBe(asset.width);
      expect(metadata.height).toBe(asset.height);
    }
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run tests/unit/warrior-icon-assets.test.ts`
Expected: FAIL with `Cannot find module '@/lib/warrior-icon-assets'` or `generateWarriorIconAssets is not defined`

- [ ] **Step 3: Implement the generation helper, CLI, and package script**

```ts
// lib/warrior-icon-assets.ts
import path from "node:path";
import { mkdir } from "node:fs/promises";

import sharp from "sharp";

const WARRIOR_FACE_CROP = {
  left: 332,
  top: 8,
  width: 360,
  height: 360
} as const;

const GENERATED_ASSETS = [
  { name: "warrior-portrait.png", size: 512 },
  { name: "agent-icon.png", size: 128 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 }
] as const;

export async function generateWarriorIconAssets(input: {
  sourcePath: string;
  outputDir: string;
}) {
  await mkdir(input.outputDir, { recursive: true });

  for (const asset of GENERATED_ASSETS) {
    await sharp(input.sourcePath)
      .extract(WARRIOR_FACE_CROP)
      .resize(asset.size, asset.size, {
        fit: "cover",
        position: "centre"
      })
      .png()
      .toFile(path.join(input.outputDir, asset.name));
  }
}
```

```ts
// scripts/generate-warrior-icons.ts
import path from "node:path";

import { generateWarriorIconAssets } from "../lib/warrior-icon-assets";

async function main() {
  const projectRoot = process.cwd();

  await generateWarriorIconAssets({
    sourcePath: path.join(projectRoot, "public/eidon-banner.png"),
    outputDir: path.join(projectRoot, "public")
  });

  console.log("Generated warrior portrait, avatar, and PWA icons.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

```json
// package.json
{
  "scripts": {
    "assets:warrior-icons": "npx tsx scripts/generate-warrior-icons.ts"
  }
}
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run tests/unit/warrior-icon-assets.test.ts`
Expected: PASS with `1 passed`

- [ ] **Step 5: Generate the real public assets**

Run: `npm run assets:warrior-icons`
Expected: `Generated warrior portrait, avatar, and PWA icons.`

- [ ] **Step 6: Commit the asset pipeline**

```bash
git add lib/warrior-icon-assets.ts scripts/generate-warrior-icons.ts package.json tests/unit/warrior-icon-assets.test.ts public/warrior-portrait.png public/agent-icon.png public/icon-192.png public/icon-512.png public/apple-touch-icon.png
git commit -m "feat: generate warrior-derived app icons"
```

## Task 2: Add the Installable PWA Shell Metadata

**Files:**
- Create: `app/manifest.ts`
- Modify: `app/layout.tsx`
- Test: `tests/unit/pwa-metadata.test.ts`

- [ ] **Step 1: Write the failing PWA metadata test**

```ts
// tests/unit/pwa-metadata.test.ts
import manifest from "@/app/manifest";
import { metadata, viewport } from "@/app/layout";

describe("PWA shell metadata", () => {
  it("declares the manifest, install icons, and Apple web app metadata", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(metadata.icons).toMatchObject({
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
    });
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      title: "Eidon",
      statusBarStyle: "black-translucent"
    });
    expect(viewport).toMatchObject({
      themeColor: "#0a0a0a",
      colorScheme: "dark"
    });
  });

  it("returns a standalone manifest wired to the warrior icons", () => {
    expect(manifest()).toMatchObject({
      name: "Eidon",
      short_name: "Eidon",
      start_url: "/",
      display: "standalone",
      background_color: "#0a0a0a",
      theme_color: "#0a0a0a",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    });
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run tests/unit/pwa-metadata.test.ts`
Expected: FAIL because `app/manifest.ts` does not exist and `metadata`/`viewport` do not yet expose the install fields

- [ ] **Step 3: Implement the manifest route and root metadata**

```ts
// app/manifest.ts
import type { MetadataRoute } from "next";

import { APP_NAME } from "@/lib/constants";

const APP_DESCRIPTION =
  "Self-hosted chat UI with streaming and lossless context compaction.";
const APP_BACKGROUND = "#0a0a0a";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
}
```

```ts
// app/layout.tsx
import type { Metadata, Viewport } from "next";

const APP_DESCRIPTION =
  "Self-hosted chat UI with streaming and lossless context compaction.";
const APP_BACKGROUND = "#0a0a0a";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: APP_BACKGROUND,
  colorScheme: "dark"
};
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run tests/unit/pwa-metadata.test.ts`
Expected: PASS with `2 passed`

- [ ] **Step 5: Typecheck the shell metadata changes**

Run: `npm run typecheck`
Expected: completes without TypeScript errors

- [ ] **Step 6: Commit the PWA shell wiring**

```bash
git add app/manifest.ts app/layout.tsx tests/unit/pwa-metadata.test.ts
git commit -m "feat: add installable pwa shell metadata"
```

## Task 3: Swap the In-App Assistant Avatar

**Files:**
- Modify: `components/message-bubble.tsx`
- Test: `tests/unit/message-bubble.test.tsx`

- [ ] **Step 1: Write the failing avatar reference test**

```tsx
// tests/unit/message-bubble.test.tsx
// @vitest-environment jsdom

import React from "react";
import { render } from "@testing-library/react";

import { MessageBubble } from "@/components/message-bubble";
import type { Message } from "@/lib/types";

function createAssistantMessage(): Message {
  return {
    id: "msg_assistant",
    conversationId: "conv_1",
    role: "assistant",
    content: "Hello from Eidon.",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 12,
    systemKind: null,
    compactedAt: null,
    createdAt: new Date().toISOString(),
    actions: [],
    timeline: [],
    attachments: []
  };
}

describe("MessageBubble", () => {
  it("uses the regenerated assistant avatar asset", () => {
    const { container } = render(<MessageBubble message={createAssistantMessage()} />);
    const avatar = container.querySelector('img[src="/agent-icon.png"]');

    expect(avatar).not.toBeNull();
    expect(container.querySelector('img[src="/chat-icon.png"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run tests/unit/message-bubble.test.tsx`
Expected: FAIL because the component still references `/chat-icon.png`

- [ ] **Step 3: Update the assistant bubble avatar source**

```tsx
// components/message-bubble.tsx
<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/6 text-[10px] font-bold text-white/60 overflow-hidden mt-1">
  <img
    src="/agent-icon.png"
    alt=""
    width={28}
    height={28}
    className="h-full w-full object-cover"
  />
</div>
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run tests/unit/message-bubble.test.tsx`
Expected: PASS with `1 passed`

- [ ] **Step 5: Run a focused regression pass for the new tests together**

Run: `npx vitest run tests/unit/warrior-icon-assets.test.ts tests/unit/pwa-metadata.test.ts tests/unit/message-bubble.test.tsx`
Expected: PASS with all targeted tests green

- [ ] **Step 6: Commit the avatar swap**

```bash
git add components/message-bubble.tsx tests/unit/message-bubble.test.tsx
git commit -m "feat: use warrior avatar across assistant messages"
```

## Task 4: Validate the PWA Install Experience in the Browser

**Files:**
- Reuse: `.dev-server` (if present)
- Reuse: `public/icon-192.png`
- Reuse: `public/icon-512.png`
- Reuse: `public/apple-touch-icon.png`

- [ ] **Step 1: Start or reuse the dev server using the project convention**

Run:

```bash
if [ -f .dev-server ]; then
  cat .dev-server
else
  npm run dev
fi
```

Expected:
- If `.dev-server` exists, it prints a URL like `http://localhost:3127`
- If it does not exist, `npm run dev` starts the server and eventually writes `.dev-server`

- [ ] **Step 2: Run browser validation with the agent-browser skill**

Check all of the following in the browser:

```text
1. Open the app using the URL from .dev-server.
2. Confirm the assistant message avatar now uses the cleaner warrior crop.
3. Open the manifest in browser tooling and confirm the app name, start URL, display mode, and icon entries.
4. Confirm the new square warrior icon is the icon surfaced for install/home-screen metadata.
5. Inspect the page in mobile emulation and confirm standalone-oriented metadata is present.
```

Expected:
- The app renders normally.
- The assistant avatar uses the new crop.
- The manifest is reachable and lists the generated install icons.
- No service worker is registered.

- [ ] **Step 3: Run the final local regression commands**

Run:

```bash
npm run typecheck
npm run lint
npx vitest run tests/unit/warrior-icon-assets.test.ts tests/unit/pwa-metadata.test.ts tests/unit/message-bubble.test.tsx
```

Expected:
- Typecheck passes
- Lint passes
- All targeted tests pass

- [ ] **Step 4: Commit any final polish discovered during browser validation**

```bash
git add app/layout.tsx app/manifest.ts components/message-bubble.tsx public/icon-192.png public/icon-512.png public/apple-touch-icon.png public/agent-icon.png public/warrior-portrait.png tests/unit/warrior-icon-assets.test.ts tests/unit/pwa-metadata.test.ts tests/unit/message-bubble.test.tsx
git commit -m "chore: validate pwa home screen experience"
```

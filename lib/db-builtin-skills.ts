import { parseSkillContentMetadata } from "@/lib/skill-metadata";

export const BUILTIN_AGENT_BROWSER_SKILL = {
  id: "builtin-agent-browser",
  name: "Agent Browser",
  description:
    "Use for web browsing, page inspection, form interaction, screenshots, and browser-based testing tasks.",
  content: `---
name: Agent Browser
description: Use for web browsing, page inspection, form interaction, screenshots, and browser-based testing tasks.
shell_command_prefixes:
  - agent-browser
---

# Agent Browser

A fast headless browser automation CLI for AI agents. Use it for any web browsing task.

## Commands

- \`agent-browser open <url>\` — Navigate to URL
- \`agent-browser click <sel>\` — Click element (use @ref from snapshot)
- \`agent-browser fill <sel> <text>\` — Clear and fill input
- \`agent-browser type <sel> <text>\` — Type into element
- \`agent-browser press <key>\` — Press key (Enter, Tab, Control+a)
- \`agent-browser snapshot\` — Get accessibility tree with refs (best for AI understanding)
- \`agent-browser screenshot [path]\` — Take screenshot (--full for full page)
- \`agent-browser eval <js>\` — Run JavaScript
- \`agent-browser scroll <dir> [px]\` — Scroll (up/down/left/right)
- \`agent-browser hover <sel>\` — Hover element
- \`agent-browser select <sel> <val>\` — Select dropdown option
- \`agent-browser get text <sel>\` — Get text content of element
- \`agent-browser close\` — Close browser

## When to Use

Use agent-browser for ALL web browsing tasks including:
- Reading web pages and articles
- Filling forms and logging in
- Clicking buttons and navigating
- Taking screenshots
- Scraping data
- Testing web applications
- Verifying your own work — after you build, change, or deploy something on a website, open it yourself and confirm it works instead of asking the user to check

Always use \`snapshot\` after \`open\` or any interaction to understand the page state. Use refs (@e1, @e2) from snapshots for clicking and filling.

## Important

- The browser stays open between tasks and keeps its sign-ins, so you do not need to close it
- Never ask the user to paste a password or one-time code into the chat
- When a page needs a password or a one-time code, call \`request_secret\` with the page's origin and the field (a snapshot ref or selector) if you have it: Eidon types the user's answer into the field without showing it to you, and fills a saved login by itself
- For a CAPTCHA, a payment confirmation or any other step only the user can do, open that step and call \`request_takeover\` if you have it: the user completes the step in your browser and returns control
- Without those tools, tell the user what to do there
- Use snapshot + refs for reliable element interaction
- For screenshots, save to /tmp/ and use the path`
};

export function deriveSkillDescription(content: string) {
  const metadata = parseSkillContentMetadata(content);

  if (metadata.description?.trim()) {
    return metadata.description.trim();
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }

    return line;
  }

  return "Reusable skill instructions.";
}

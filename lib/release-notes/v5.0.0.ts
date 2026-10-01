import type { ReleaseHighlight } from "@/lib/release-notes/types";

export const releaseNote: ReleaseHighlight = {
  version: "v5.0.0",
  date: "2026-10-01",
  bullets: [
    "Watch your bot's browser live in the chat, and take over when it hits a login",
    "Bots ask before running shell commands or MCP tools, and you can allow them once or always",
    "Emails and Slack messages arrive as drafts you edit and send, so nothing goes out by surprise",
    "A skill you write once is available to your whole agent team, and unused ones are tidied up",
    "Get a phone notification the moment an automation finishes, via Pushover, ntfy or the browser"
  ]
};

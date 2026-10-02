import type { ReleaseHighlight } from "@/lib/release-notes/types";

export const releaseNote: ReleaseHighlight = {
  version: "v5.0.0",
  date: "2026-10-01",
  bullets: [
    "Live browser view: you can watch your bot work in the chat and take over when it hits a login",
    "Tool approvals: you can allow a bot's shell commands and MCP tools once, or always",
    "Draft-first messages: you can edit every email and Slack message before it is sent, so nothing goes out by surprise",
    "Shared skills: you can write a skill once and use it across your whole team, and unused ones are tidied up",
    "Finish alerts: you can get a phone notification the moment an automation finishes, via Pushover, ntfy or the browser"
  ]
};

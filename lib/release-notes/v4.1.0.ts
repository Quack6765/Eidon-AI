import type { ReleaseHighlight } from "@/lib/release-notes/types";

export const releaseNote: ReleaseHighlight = {
  version: "v4.1.0",
  date: "2026-09-16",
  bullets: [
    "What's new window: you can reopen the list of what changed any time from the version in Settings",
    "Fresh start: you can clear a bot's conversation and keep its files, skills, memories and browser session",
    "Self-checking bots: you can stop checking website work yourself, because bots now test it in their own browser",
    "Focused memory: you are offered only what outlives the chat, like a birthday or a preference, not the last task",
    "Compact status line: you can see a summary like '3 tools, 4 web searches' and expand it to every call",
    "Text that stays: you can read what the assistant wrote before a tool call instead of watching it vanish"
  ]
};

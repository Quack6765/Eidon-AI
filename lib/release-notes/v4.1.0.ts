import type { ReleaseHighlight } from "@/lib/release-notes/types";

export const releaseNote: ReleaseHighlight = {
  version: "v4.1.0",
  date: "2026-09-16",
  bullets: [
    "After each update, a What's new window lists what changed — you can reopen it any time from the version in Settings",
    "Clear a bot's conversation to start it fresh — its files, skills, memories, and browser session are kept",
    "Bots now test website work in their own browser and stop asking you to check what they can verify themselves",
    "Memory offers only what outlives the chat — a birthday, a dislike, a preference — not the task you just finished",
    "The compact status line settles on a count summary like '3 tools, 4 web searches' and expands to every call",
    "Text the assistant writes before a tool call stays on screen instead of disappearing when the tool starts"
  ]
};

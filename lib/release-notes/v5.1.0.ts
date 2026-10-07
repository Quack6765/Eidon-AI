import type { ReleaseHighlight } from "@/lib/release-notes/types";

export const releaseNote: ReleaseHighlight = {
  version: "v5.1.0",
  date: "2026-10-07",
  bullets: [
    "Vault: you can store passwords and API keys once, and the agent fills them in without ever seeing the values",
    "Python tool: the agent now more proactively runs Python for exact math and data work, installing packages per run via uv",
    "Follow-ups: you can choose whether a message sent mid-run steers the agent immediately or queues until it finishes",
    "Parallel tools: you get faster turns when the agent runs independent searches, page reads and lookups at once",
    "Stability and reliability: overall fixes when it comes to prompt caching, token counting, and tool calls"
  ]
};

import type { PromptMessage } from "@/lib/types";

function buildDateContextContent() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long"
  });

  return [
    "Current date and time context for this request (not shown to the user):",
    `- Local: ${localTime} (${timezone})`,
    `- UTC: ${now.toISOString()}`
  ].join("\n");
}

export function withDateContextUserMessage(messages: PromptMessage[]): PromptMessage[] {
  return [...messages, { role: "user", content: buildDateContextContent() }];
}

export function withDateContextSystemPrompt(systemPrompt: string) {
  const context = buildDateContextContent();
  return `${systemPrompt.trim()}\n\n${context}`;
}

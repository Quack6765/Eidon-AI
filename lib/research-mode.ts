import {
  MAX_RESEARCH_PLAN_STEPS,
  MAX_RESEARCH_PLAN_STEP_CHARS,
  MAX_RESEARCH_TOOL_STEPS,
  RESEARCH_COLLAPSED_TOOL_RESULT_CHARS,
  RESEARCH_STEP_MULTIPLIER
} from "@/lib/constants";
import type { ChatResearchOptions, PromptMessage } from "@/lib/types";

export const RESEARCH_FINAL_ANSWER_DIRECTIVE =
  "Stop using tools now. Write the final research report from the findings gathered so far: title, executive summary, findings per plan section with inline source links, gaps or open questions, and a Sources list. Do not call any more tools.";

const COLLAPSED_TOOL_RESULT_NOTE =
  "\n[Earlier tool result collapsed to save context. Rely on the findings digest you wrote after that round.]";

export function parseResearchPlan(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESEARCH_PLAN_STEPS) return null;
  const plan: string[] = [];
  for (const step of value) {
    if (typeof step !== "string" || step.length > MAX_RESEARCH_PLAN_STEP_CHARS) return null;
    const trimmed = step.trim();
    if (!trimmed) return null;
    plan.push(trimmed);
  }
  return plan;
}

export function parseResearchRequest(value: unknown): ChatResearchOptions | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key]) => key !== "plan")) return null;
  const rawPlan = (value as { plan?: unknown }).plan;
  if (rawPlan === undefined) return {};
  const plan = parseResearchPlan(rawPlan);
  return plan ? { plan } : null;
}

export function resolveResearchStepBudget(baseSteps: number) {
  return Math.max(1, Math.min(Math.round(baseSteps) * RESEARCH_STEP_MULTIPLIER, MAX_RESEARCH_TOOL_STEPS));
}

export function formatResearchPlan(plan: string[]) {
  return plan.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

export function buildResearchDirective(plan?: string[]) {
  const lines = [
    "Deep research mode is active for this turn. The user expects a thorough, well-sourced report rather than a quick answer, and is willing to wait while you work.",
    plan?.length
      ? `Follow this research plan, adapting it only when the evidence demands it:\n${formatResearchPlan(plan)}`
      : "Begin by writing a short numbered research plan (3-8 steps) covering the facets of the question, then execute it.",
    "Work each plan step in rounds: call web_search with several distinct queries in one call, then call read_page on the most relevant result URLs (several in the same step; they run in parallel) to read full pages instead of relying on snippets. Use the agent-browser skill only for pages read_page cannot fetch (JavaScript-rendered, login-gated, interactive).",
    "Prefer primary sources and corroborate important claims with at least two independent sources. Re-query when results are thin, contradictory, or outdated.",
    "After each round, write a brief findings digest in your reply text: key facts with their source URLs, what remains open, and what you will search next. Earlier tool results may be collapsed later in the turn, so the digest is your durable memory.",
    "Keep going until every plan step is covered or you are told to stop. Do not stop after the first search round.",
    "Finish with a self-contained Markdown report: a title, an executive summary, findings organized by plan section with inline citation links, a section on gaps and open questions, and a Sources list of every URL you relied on."
  ];
  return lines.join("\n\n");
}

export function collapseOlderToolResults(promptMessages: PromptMessage[]): PromptMessage[] {
  let latestRoundStart = -1;
  for (let index = promptMessages.length - 1; index >= 0; index -= 1) {
    const message = promptMessages[index];
    if (message.role === "assistant" && message.toolCalls?.length) {
      latestRoundStart = index;
      break;
    }
  }
  if (latestRoundStart <= 0) return promptMessages;

  return promptMessages.map((message, index) => {
    if (index >= latestRoundStart || message.role !== "tool" || typeof message.content !== "string") return message;
    if (message.content.length <= RESEARCH_COLLAPSED_TOOL_RESULT_CHARS + COLLAPSED_TOOL_RESULT_NOTE.length) return message;
    return {
      ...message,
      content: `${message.content.slice(0, RESEARCH_COLLAPSED_TOOL_RESULT_CHARS)}${COLLAPSED_TOOL_RESULT_NOTE}`
    };
  });
}

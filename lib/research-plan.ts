import { callProviderText } from "@/lib/provider";
import { MAX_RESEARCH_PLAN_STEPS, MAX_RESEARCH_PLAN_STEP_CHARS } from "@/lib/constants";
import { parseResearchPlan } from "@/lib/research-mode";
import type { RuntimeProviderProfile } from "@/lib/types";

export const RESEARCH_PLANNING_TIMEOUT_MS = 20_000;
const FALLBACK_TOPIC_CHARS = 160;

export function buildResearchPlanningPrompt(message: string) {
  return [
    "You are planning a deep research task for an AI assistant that can search the web and read full pages.",
    "Draft a research plan for the request below as 3 to 8 numbered steps. Each step is one specific, self-contained line of inquiry: what to find out and where it is likely to be found (official sources, documentation, reviews, data, comparisons). Order the steps so early findings inform later ones, and end with cross-checking or synthesis.",
    `Respond with a JSON array of strings only, no prose, no numbering inside the strings, each under ${MAX_RESEARCH_PLAN_STEP_CHARS} characters.`,
    "",
    "Request:",
    message.trim()
  ].join("\n");
}

export function buildResearchPlanRevisionPrompt(input: { message: string; plan: string[]; instruction: string }) {
  return [
    "You are revising a research plan for a deep research task run by an AI assistant that can search the web and read full pages.",
    "Apply the follow-up instruction from the user to the current plan below. Keep every step the instruction does not change, revise or remove the ones it does, and add new steps only when the instruction asks for them. Steps stay ordered so early findings inform later ones.",
    `Respond with the complete revised plan as a JSON array of strings only, no prose, no numbering inside the strings, at most ${MAX_RESEARCH_PLAN_STEPS} steps, each under ${MAX_RESEARCH_PLAN_STEP_CHARS} characters.`,
    "",
    "Request:",
    input.message.trim(),
    "",
    "Current plan:",
    input.plan.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "",
    "Follow-up instruction:",
    input.instruction.trim()
  ].join("\n");
}

export function parseResearchPlanResponse(text: string): string[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const steps = parsed
    .filter((step): step is string => typeof step === "string")
    .map((step) => step.replace(/^\s*\d+[.)]\s*/, "").trim().slice(0, MAX_RESEARCH_PLAN_STEP_CHARS))
    .filter(Boolean)
    .slice(0, MAX_RESEARCH_PLAN_STEPS);
  return parseResearchPlan(steps);
}

export function buildFallbackResearchPlan(message: string) {
  const topic = message.trim().replace(/\s+/g, " ").slice(0, FALLBACK_TOPIC_CHARS);
  return [
    `Search for authoritative and recent sources on: ${topic}`,
    "Read the most relevant pages in full and extract the key facts, figures, and dates with their URLs",
    "Cross-check important claims across at least two independent sources and note disagreements",
    "Compile a cited report with an executive summary, findings, open questions, and a sources list"
  ];
}

export async function generateResearchPlan(input: {
  message: string;
  settings: RuntimeProviderProfile;
  abortSignal?: AbortSignal;
  currentPlan?: string[];
  instruction?: string;
}) {
  const revising = Boolean(input.currentPlan?.length && input.instruction);
  const prompt = revising
    ? buildResearchPlanRevisionPrompt({
        message: input.message,
        plan: input.currentPlan ?? [],
        instruction: input.instruction ?? ""
      })
    : buildResearchPlanningPrompt(input.message);
  let text: string;
  try {
    const signals = [AbortSignal.timeout(RESEARCH_PLANNING_TIMEOUT_MS), input.abortSignal].filter(
      (signal): signal is AbortSignal => Boolean(signal)
    );
    text = await callProviderText({
      settings: input.settings,
      prompt,
      purpose: "research_planning",
      abortSignal: AbortSignal.any(signals)
    });
  } catch (error) {
    if (revising) throw error;
    return buildFallbackResearchPlan(input.message);
  }
  const plan = parseResearchPlanResponse(text);
  if (plan) return plan;
  if (revising) throw new Error("The research plan could not be updated");
  return buildFallbackResearchPlan(input.message);
}

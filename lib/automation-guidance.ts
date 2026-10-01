const TOOL_DESCRIPTION =
  "Propose an automation when the user explicitly asks for something to run on its own or expresses an unmistakably recurring need — either on a schedule (\"check this every morning\") or once at a given moment (\"remind me tomorrow to X\", \"ping me in an hour\", \"do this once at 3pm\"). The prompt must be complete and self-contained — runs do not see this conversation. Pick the smallest schedule that matches the request: an interval of at least 5 minutes, daily/weekly at a specific local time, or schedule_kind 'once' with run_at for a single run, which fires exactly once and then deletes itself. Set continue_previous_conversation to true only when each recurring run should build on the previous run's result; leave it false for 'once'. This does not create anything: it renders a pending proposal card (name, schedule, full prompt, continuity) that the user must approve before anything is scheduled. Never claim an automation was created or scheduled — say you proposed it and that the user can review and approve it.";

const SYSTEM_GUIDANCE = (timeZone: string) =>
  `You can propose automations with the create_automation tool, both recurring tasks and one-off requests. Use schedule_kind 'once' with run_at for anything the user asks for a single time — a reminder, a one-shot check, "do this tomorrow at 9". A 'once' automation runs exactly once and then deletes itself, and it notifies the user when it finishes. Resolve every relative expression the user uses ("tomorrow", "in an hour", "Friday evening") against the server timezone ${timeZone}, emit run_at as an absolute ISO 8601 instant with a UTC offset, and state the resolved date and time back to the user in the reply. Use 'interval' or 'calendar' only when the user wants something to repeat. Write the prompt as complete, self-contained instructions for a fresh run; it supports {{date}}, {{run_number}}, and {{last_result}}. The call only shows the user an approval card — nothing is scheduled until they approve it, so never claim an automation was created.`;

export function buildCreateAutomationDescription() {
  return TOOL_DESCRIPTION;
}

export function buildAutomationProposalGuidance(timeZone: string) {
  return SYSTEM_GUIDANCE(timeZone);
}

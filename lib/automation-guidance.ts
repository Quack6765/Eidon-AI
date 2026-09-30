const TOOL_DESCRIPTION =
  "Propose an automation when the user asks for something to run on its own — on a schedule (\"check this every morning\") or once at a given moment (\"remind me tomorrow to X\"). The prompt must be complete and self-contained — runs do not see this conversation. Pick the smallest schedule that matches the request: an interval of at least 5 minutes, daily/weekly at a local time, or schedule_kind 'once' with run_at, which fires a single time and then deletes the automation. Set continue_previous_conversation to true only when each recurring run should build on the previous run's result. This does not create anything: it renders a pending proposal card the user must approve. Never claim an automation was created or scheduled — say you proposed it and that they can review and approve it.";

const SYSTEM_GUIDANCE = (timeZone: string) =>
  `You can propose automations with create_automation, for recurring tasks and one-off requests alike. Use schedule_kind 'once' with run_at for anything wanted a single time (a reminder, "tomorrow at 9"): it fires once, deletes itself and notifies. Resolve relative times against the server timezone ${timeZone} into an absolute ISO instant with an offset, and state the resolved moment back to the user. Write the prompt as complete, self-contained instructions; {{date}}, {{run_number}} and {{last_result}} still apply. The call only shows the user an approval card — nothing is scheduled until they approve it, so never claim an automation was created.`;

export function buildCreateAutomationDescription() {
  return TOOL_DESCRIPTION;
}

export function buildAutomationProposalGuidance(timeZone: string) {
  return SYSTEM_GUIDANCE(timeZone);
}

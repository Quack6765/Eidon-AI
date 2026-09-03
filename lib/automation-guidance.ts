const TOOL_DESCRIPTION =
  "Propose a scheduled automation when the user explicitly asks for something to run on a schedule or expresses an unmistakably recurring need (for example \"check this every morning\"). The prompt must be complete and self-contained — scheduled runs do not see this conversation. Pick the smallest schedule that matches the request (an interval of at least 5 minutes, or daily/weekly at a specific local time), and set continue_previous_conversation to true when each run should build on the previous run's result. This does not create anything: it renders a pending proposal card (name, schedule, full prompt, continuity) that the user must approve before anything is scheduled. Never claim an automation was created or scheduled — say you proposed it and that the user can review and approve it.";

const SYSTEM_GUIDANCE =
  "You can propose scheduled automations with the create_automation tool, but only when the user explicitly asks for a recurring task or expresses an unmistakably recurring need — never for one-off requests. Write the prompt as complete, self-contained instructions for a fresh run; it supports {{date}}, {{run_number}}, and {{last_result}}. The call only shows the user an approval card — nothing is scheduled until they approve it, so never claim an automation was created.";

export function buildCreateAutomationDescription() {
  return TOOL_DESCRIPTION;
}

export function buildAutomationProposalGuidance() {
  return SYSTEM_GUIDANCE;
}

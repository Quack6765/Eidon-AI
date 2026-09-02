export const MAX_AUTOMATION_LAST_RESULT_CHARS = 4000;

const TRUNCATION_MARKER = "\n[…truncated]";

function truncateLastResult(text: string) {
  if (text.length <= MAX_AUTOMATION_LAST_RESULT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_AUTOMATION_LAST_RESULT_CHARS - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function replaceToken(prompt: string, token: string, value: string) {
  return prompt.replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, "g"), () => value);
}

export function renderAutomationPrompt(input: {
  prompt: string;
  date: string;
  runNumber: number;
  previousResult: string | null;
}) {
  let rendered = input.prompt;
  rendered = replaceToken(rendered, "date", input.date);
  rendered = replaceToken(rendered, "run_number", String(Math.max(1, Math.floor(input.runNumber))));
  rendered = replaceToken(
    rendered,
    "last_result",
    input.previousResult === null ? "" : truncateLastResult(input.previousResult)
  );
  return rendered;
}

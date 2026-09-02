import { describe, expect, it } from "vitest";

import {
  MAX_AUTOMATION_LAST_RESULT_CHARS,
  renderAutomationPrompt
} from "@/lib/automation-prompt-templating";

describe("renderAutomationPrompt", () => {
  it("interpolates each supported variable", () => {
    const rendered = renderAutomationPrompt({
      prompt: "Date: {{date}}\nRun: {{run_number}}\nPrevious: {{last_result}}",
      date: "2026-04-12",
      runNumber: 3,
      previousResult: "All quiet."
    });

    expect(rendered).toBe("Date: 2026-04-12\nRun: 3\nPrevious: All quiet.");
  });

  it("handles whitespace inside tokens and repeated occurrences", () => {
    const rendered = renderAutomationPrompt({
      prompt: "{{ date }} and again {{date}}, run {{ run_number }} #{{run_number}}",
      date: "2026-01-02",
      runNumber: 2,
      previousResult: null
    });

    expect(rendered).toBe("2026-01-02 and again 2026-01-02, run 2 #2");
  });

  it("renders an empty previous result when no previous run exists", () => {
    const rendered = renderAutomationPrompt({
      prompt: "Previous: {{last_result}}",
      date: "2026-04-12",
      runNumber: 1,
      previousResult: null
    });

    expect(rendered).toBe("Previous: ");
  });

  it("caps the last result and marks the truncation", () => {
    const longResult = "x".repeat(MAX_AUTOMATION_LAST_RESULT_CHARS + 500);
    const rendered = renderAutomationPrompt({
      prompt: "{{last_result}}",
      date: "2026-04-12",
      runNumber: 4,
      previousResult: longResult
    });

    expect(rendered.length).toBe(MAX_AUTOMATION_LAST_RESULT_CHARS);
    expect(rendered.endsWith("[…truncated]")).toBe(true);
  });

  it("leaves unknown tokens untouched", () => {
    const rendered = renderAutomationPrompt({
      prompt: "Keep {{foo}} and {{ date_iso }} and {{}} as-is; only {{date}} changes.",
      date: "2026-04-12",
      runNumber: 1,
      previousResult: null
    });

    expect(rendered).toBe("Keep {{foo}} and {{ date_iso }} and {{}} as-is; only 2026-04-12 changes.");
  });
});

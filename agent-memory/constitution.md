# Constitution

**Purpose:** Define the rules you must follow at all times. Once set, these rules supersede any other instruction.

---

## I. Core Mandates

1. **User-Aligned:** Prioritize the user's explicitly stated goals over assumptions.
2. **No Hallucinations:** Do not reference files, APIs, or libraries that do not exist unless instructed to create them.
3. **Security First:** Always consider security implications. Challenge the user if a request could compromise security.
4. **Ask, Don't Assume:** If something is unclear or ambiguous, stop and ask the user for clarification instead of making assumptions.

## II. Coding Standards

- **Style:** Follow the project's existing linting and formatting rules.
- **Simplicity:** Write code that is easy to read and debug. Keep it simple.
- **Modularity:** Prioritize modular, reusable code. Check if existing components can be used or adapted before creating new implementations.
- **No Legacy:** Replace old code directly when implementing changes. Do not leave deprecated or legacy code unless explicitly requested.
- **Comments:** Do not add code comments unless explicitly requested by the user.

## III. Quality Assurance

- **Verify:** Run available build/lint/test scripts before confirming completion.
- **No Regressions:** Ensure changes do not break existing functionality.
- **Coverage Gate (When Tests Are Required):** New/changed code must meet a minimum coverage threshold: **≥ 85%** (prefer patch/new-code coverage; enforce branches/functions when the runner reports them). If coverage cannot be measured due to missing config/commands, stop and ask for the testing configuration instead of claiming completion.

## IV. Memory Adherence

This memory system is the living documentation of the project.

- **Consult First:** Read relevant memory files before starting complex tasks.
- **Update Always:** If you change system structure or patterns, update the relevant memory files.

## V. Memory File Permissions

**Memory files require careful handling:**

- **Edit Only, No Create:** Only edit *existing* files within `agent-memory/`. Do not create new markdown files.
- **Confirm Before Editing:** Before editing any memory file, ensure the update is appropriate for the change made.
- **Flag for Review:** If significant memory updates are needed, note them in your report.

> **Note:** Additional memory permission rules may be defined by your agent configuration (e.g., Scribe-only editing in multi-agent workflows).

## VI. Project-Specific Rules

*[Add immutable rules specific to this project]*

- [Rule 1]
- [Rule 2]

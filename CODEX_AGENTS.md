## Prime Directive

**ALWAYS read these files FIRST before doing anything else:**

1. `agent-memory/index.md` — Your navigation map for project context
2. `agent-memory/constitution.md` — The rules you MUST follow

These files are your foundation. Do not proceed without loading them.

---

## Core Mandates (from Constitution)

1. **User-Aligned:** Prioritize the user's explicitly stated goals over assumptions.
2. **No Hallucinations:** Do not reference files, APIs, or libraries that do not exist unless instructed to create them.
3. **Security First:** Always consider security implications. Challenge the user if a request could compromise security.
4. **Ask, Don't Assume:** If something is unclear or ambiguous, stop and ask the user for clarification instead of making assumptions.

### Coding Standards

- **Style:** Follow the project's existing linting and formatting rules.
- **Simplicity:** Write code that is easy to read and debug. Keep it simple.
- **Modularity:** Prioritize modular, reusable code. Check if existing components can be used or adapted before creating new implementations.
- **No Legacy:** Replace old code directly when implementing changes. Do not leave deprecated or legacy code unless explicitly requested.
- **No Comments:** Do not add code comments unless explicitly requested by the user.

---

## Your Unified Workflow

Since you are a single agent (no subagents), you perform all phases yourself:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CODEX UNIFIED WORKFLOW                       │
├─────────────────────────────────────────────────────────────────┤
│  1. DISCOVER  →  2. PLAN  →  3. BUILD  →  4. VERIFY  →  5. REPORT │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Discovery (Scout Mode)

Before writing any code, you MUST understand the codebase context.

### Step 1.1: Load Memory Index

Read `agent-memory/index.md` to understand what memory modules exist.

### Step 1.2: Categorize the Request

Determine what areas of the codebase are involved:

| Area | Examples |
|------|----------|
| Frontend | UI, components, pages, styling |
| Backend | API, services, jobs, business logic |
| Data | Models, validation, database |
| Infrastructure | Config, deployment, testing |
| Integrations | External APIs, payments, notifications |
| Security | Auth, access control, secrets |

### Step 1.3: Load Relevant Memory Modules

Based on the task category, load the appropriate memory files from `agent-memory/`. The index tells you which files to load for each type of work.

**Common modules:**
- `agent-memory/architecture/stack.md` — Languages, frameworks, libraries
- `agent-memory/infrastructure/testing.md` — Test conventions
- `agent-memory/frontend/ui.md` — UI patterns and design system
- `agent-memory/backend/api.md` — API conventions

### Step 1.4: Find Pattern Files

Search the codebase for:
- **Similar implementations** — Existing features similar to what's requested
- **Template files** — Files that should be copied/adapted
- **Convention examples** — How similar things are structured

### Step 1.5: Identify Files to Change

Determine:
- **Files to create** — New files with suggested paths based on project structure
- **Files to modify** — Existing files that need changes
- **Integration points** — Where new code connects to existing code

---

## Phase 2: Planning

For complex tasks, break down the work:

1. **List subtasks** in execution order
2. **Identify dependencies** between subtasks
3. **Note potential risks** or areas needing clarification

For simple/trivial tasks, you may skip explicit planning and proceed directly to implementation.

---

## Phase 3: Build (Implementation)

### Step 3.1: Deep Code Analysis (MANDATORY)

**⚠️ COMPLETE THIS BEFORE WRITING ANY CODE**

Read every pattern file thoroughly. For each file, analyze:

**Code Quality Standards:**
- Error handling patterns
- Null/undefined handling
- Validation patterns
- Type safety level

**Naming Conventions:**
- Variables (camelCase, SCREAMING_SNAKE_CASE for constants)
- Functions (verb prefixes: get, set, handle, on, is, has, should)
- Files (kebab-case, PascalCase for components)
- Interfaces/Types (prefixes/suffixes: I, T, Props, State)

**Architectural Patterns:**
- Separation of concerns
- Abstraction layers
- Dependency injection
- State management
- Data flow patterns

**Code Style:**
- Import organization
- Function signatures
- Control flow (early returns, guard clauses)
- Whitespace and formatting

### Step 3.2: Implement

Write your code following the analyzed patterns. Your new code should look like it was written by the same developer who wrote the existing code.

**Implementation Checklist:**
- [ ] Apply the same error handling patterns
- [ ] Use identical naming conventions
- [ ] Organize imports the same way
- [ ] Match the same level of abstraction
- [ ] Follow the same control flow patterns

### Step 3.3: Write Tests (When Appropriate)

**You MUST update existing tests or add new tests when your changes affect tested behavior.** Be thorough but pragmatic—test the contract and edge cases, not every implementation detail.

**WRITE TESTS FOR:**
- Business logic and data transformations
- Authentication/authorization
- Data processing and API integrations
- Critical user flows
- Complex conditionals
- Error handling
- New API endpoints or payload changes
- Edge cases (null handling, deleted records, boundary conditions)

**DO NOT WRITE TESTS FOR:**
- Styling changes (colors, fonts, CSS)
- Copy/text updates
- Simple UI tweaks
- Config changes

**Test Quality Standards:**
- Test names must accurately describe what is being asserted
- Use specific assertions (`expect(value).toBe(expected)`) over weak ones (`expect.anything()`)
- Cover edge cases: null values, empty arrays, deleted records, permission boundaries
- If modifying existing code, check if related tests need updates—don't leave tests asserting outdated behavior

---

## Phase 4: Verification

After implementation, verify your work:

### Step 4.1: Build Verification

```bash
# Run linting (if available)
npm run lint
# or
pnpm lint
# or project-specific command

# Run type checking (if applicable)
npm run typecheck
# or
tsc --noEmit
```

### Step 4.2: Test Execution

Run tests relevant to your changes:

```bash
# Run in non-interactive mode
npm run test -- --passWithNoTests
# or for specific files
npm run test -- path/to/changed-file.test.ts
```

### Step 4.3: Self-Audit Checklist

Before reporting completion, verify:

- [ ] **No regressions** — Existing functionality still works
- [ ] **Follows patterns** — Code matches existing conventions
- [ ] **No security issues** — Sensitive data handled correctly
- [ ] **Build passes** — No lint/type errors
- [ ] **Tests pass** — All relevant tests green

---

## Phase 5: Report

When complete, provide a structured report:

```markdown
## ✅ Implementation Complete

### What Was Done
- [Summary of changes]

### Files Created
- `path/to/new-file.ts` — [purpose]

### Files Modified
- `path/to/file.ts` — [what changed]

### Context Used
- Memory: [modules loaded]
- Patterns: [files referenced]

### Build Status
- Lint: ✅ Passed
- Types: ✅ Passed

### Tests
- [Test status or justification for skipping]

### Notes
- [Any observations or recommendations]
```

---

## Handling Uncertainty

When you encounter ambiguity:

1. **Ask, don't assume** — Request clarification from the user
2. **Match existing code** — When in doubt, look at how existing code handles it
3. **Start small** — Propose a minimal solution, get feedback, iterate

---

## Memory File Permissions

You are responsible for keeping the `agent-memory/` documentation current.

### Rules

- ✅ **Edit existing files** — You MAY edit any existing `.md` file in `agent-memory/`
- ❌ **No new files** — You may NOT create new markdown files in `agent-memory/`
- ❌ **No deletions** — You may NOT delete memory files

### When to Update Memory

Update the relevant memory file when your implementation:

| Change Type | Update Required |
|-------------|-----------------|
| New API endpoint | `agent-memory/backend/api.md` |
| New component pattern | `agent-memory/frontend/ui.md` |
| Database schema change | `agent-memory/architecture/database.md` |
| New environment variable | `agent-memory/infrastructure/config.md` |
| New integration | `agent-memory/integrations/*.md` |
| Authentication change | `agent-memory/security/auth.md` |

### How to Update Memory

1. **Be concise** — Add only what's necessary for future context
2. **Match existing format** — Follow the structure already in the file
3. **No placeholders** — Only document what actually exists
4. **Append, don't replace** — Add to existing sections rather than rewriting

---

## Quick Reference: Task Complexity

### Simple Tasks (Fast Path)

For trivial changes (typos, copy updates, simple config):
1. Load constitution + relevant memory
2. Find the file(s) to change
3. Make the change
4. Verify build passes
5. Report completion

### Standard Tasks

For most features and fixes:
1. Full discovery phase
2. Light planning
3. Analysis + implementation
4. Full verification
5. Detailed report

### Complex Tasks

For multi-file refactors, new features, or security-sensitive changes:
1. Thorough discovery
2. Explicit planning with subtasks
3. Deep analysis + careful implementation
4. Comprehensive verification
5. Detailed report with notes

---

## Environment Notes

You are running in **Codex CLI** — a single-agent environment without subagent support.

- All work is performed by you directly
- Use shell commands for verification (lint, test, build)
- The `agent-memory/` system is your primary source of project context
- When confused, ask the user rather than guessing

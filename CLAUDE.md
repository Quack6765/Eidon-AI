# Project Instructions

## UI/UX Validation

Always use the `agent-browser` skill to test and validate any UI/UX changes before reporting completion. This includes layout changes, styling updates, component modifications, and any visual or interactive changes to the frontend.

To validate:
1. Open the relevant page in the browser via `agent-browser`
2. Take a screenshot to verify the visual output
3. Test interactive elements (clicks, form inputs, navigation)
4. Confirm the changes match the intended behavior

### Dev Server

- You may start the dev server (`npm run dev`) when needed.
- **Before starting**, check if something is already running on port 3000 (`lsof -i :3000`). If a process is found, kill it first, then start fresh.
- After starting, wait for the server to be ready before proceeding with validation.

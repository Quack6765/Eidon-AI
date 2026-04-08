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
- The dev server uses a random port in the 3000-4000 range to support multiple worktrees.
- **Before starting**, check if a `.dev-server` file exists in the project root.
  - If it exists, read the URL from it (first line) and use that for testing.
  - If the file exists but the server is not running (cannot connect), delete it and start fresh.
- After starting `npm run dev`, wait for the `.dev-server` file to appear, then read the URL from it.
- The `.dev-server` file format is:
  ```
  http://localhost:3127
  PID: 12345
  ```

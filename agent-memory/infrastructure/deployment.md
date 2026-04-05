# Deployment

## Pipeline
- **CI/CD Tool:** [Tool name]
- **Trigger:** [On push / On tag / Manual]

## Commands
- **Staging:** `[Deploy command]`
- **Production:** `[Deploy command]`

## Process
1. [Step 1]
2. [Step 2]
3. [Step N]

## Runtime Notes
- Docker production images must copy the Next.js `public/` directory into the runner stage in addition to `.next/standalone` and `.next/static`, otherwise static assets like `/chat-icon.png` and `/logo.png` will 404 in the deployed app.
- Docker build on ARM64 requires `chromium` installed via `apt-get` since `Chrome for Testing` doesn't provide ARM64 builds. `agent-browser` in the Docker environment is wrapped to point to the system-installed `chromium`.
- Next.js requires `output: "standalone"` in `next.config.ts` for the Docker `runner` stage to correctly copy the `.next/standalone` build output.
## Rollback
- **Strategy:** [How to rollback]
- **Command:** `[Rollback command if applicable]`

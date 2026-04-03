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

## Rollback
- **Strategy:** [How to rollback]
- **Command:** `[Rollback command if applicable]`

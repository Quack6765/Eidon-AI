# Agent Computer for bots: implementation plan

## Context

**What we're building.** Bots already browse through the `agent-browser` CLI, called through `execute_shell_command`. Users can't watch the browser, step in for a login, 2FA, CAPTCHA or payment, or hand over a secret safely. We want Grok Bot's "Agent Computer": a live view, take control and return control, and secure secret requests, with credentials that can be saved.

**Constraint.** It must not add a heavy new layer or bloat the Docker image.

**Groundwork.** The analysis is in `docs/plans/agent-computer-analysis.md` (commits `65c787f9`, `253a96ae`). It showed that the agent-browser stream server already in the image provides frames and input. The recommendation adds **no new apt packages** and saves about 60 MB.

**Problems found today, fixed along the way:**
- The image is silently stuck on agent-browser 0.27.0, because newer versions need Node 24.
- Every bot of every user writes cookies to one shared plaintext file: `/app/data/home/.agent-browser/sessions/bot-bot.json`.
- Logins don't survive `agent-browser close`.
- Any bot's shell can drive another bot's browser over loopback.

## Locked decisions (2026-09-25)

| Topic | Decision |
|---|---|
| Base image | **Node 24** (`node:24-bookworm-slim`), agent-browser pinned to **0.38.1**, `better-sqlite3` → **12.x** |
| Browser model | **One shared Chromium + profile per user, one pinned tab per bot** (−43 % RAM, measured). Never shared across users |
| Live view transport | Server relays each bot session's loopback agent-browser stream over a new WS path on the existing server, with the same auth |
| Pause/resume | Reuse the approval gate from `bot-interactive-approvals`, with new action kinds `computer_handoff` and `secret_request` |
| Run status | Rename `waiting_approval` → **`waiting_user`** on the approvals branch **before it merges** |
| Handoff and secret timeout | **30 minutes**. The bot's tab stays alive while waiting |
| Stored credentials | Ship **with** the secrets phase. A bot may reuse a saved credential for the same origin without asking again |
| Isolation | **Landlock + in-process egress proxy** (0 MB). Warn in Settings when the kernel lacks Landlock. No uid split, no sidecar |
| Availability | **On for every bot.** A memory budget prevents overload |
| Scope of view | Browser only. The terminal and files are already visible through shell actions and the workspace tree |

## Architecture (reference)

```
Per-user Chromium (--user-data-dir=<data>/agent-computer/<user>/profile, headless, CDP on loopback)
  └─ tab per bot ← agent-browser session <botId> (--cdp <port> --pin-tab), with its own loopback stream WS
        ▲ frames/url/tabs/status        │ input_mouse / input_keyboard / input_touch
Eidon server lib/agent-computer.ts: browser host + relay hub (latest-frame fan-out, fps cap,
  controlOwner "bot"|"user", secret typing)
        ▲ binary JPEG + JSON             │ JSON input (only from the owner while they hold control)
Web: /ws/computer?botId=   iOS: /api/v1/ws/computer?botId=   (same routeWebSocketUpgrade + auth)
```

## Delivery: PRs in order

Feature PRs target `dev`. Each PR carries its own contract updates.

### PR 0: Node 24 + agent-browser pin
- `Dockerfile`:
  - `FROM node:24-bookworm-slim`.
  - `npm install -g agent-browser@0.38.1`.
  - Delete the non-matching `bin/agent-browser-*` binaries (keep `linux-<arch>`; −60 MB).
  - Check that the `agent-browser-core` wrapper still works with 0.38's postinstall bin repointing.
- `package.json` / `package-lock.json`: `better-sqlite3` `^12.11.1` (12.0's only break is dropping Node 18) and `@types/node` `^24`.
- `.github/workflows/test.yml`: `node-version: 24`.
- Verification:
  - `npm test`, lint and typecheck.
  - An image build in CI. The local 2 GB Colima VM runs out of memory on `next build`, so build locally only with more VM memory.
  - Run `agent-browser --version` in the image.

### PR 1: Browser host (per-user shared browser, persistence, memory budget)

**First task: verify how a bot session inherits CDP and pinning.** Bots type bare `agent-browser …` commands, so the settings must arrive through env or config, not flags. Look for `AGENT_BROWSER_CDP` / `AGENT_BROWSER_PIN_TAB` env support, or `AGENT_BROWSER_CONFIG` pointing at a server-owned config file, in the 0.38.1 docs and source. `AGENT_BROWSER_PIN_TAB` is documented. Use whichever exists; never rely on the bot adding flags.

**New `lib/agent-computer.ts` (host part):**
- **`ensureUserBrowser(userId)`**:
  - Spawn `/usr/bin/chromium --headless=new --no-sandbox --disable-dev-shm-usage --user-data-dir=<EIDON_DATA_DIR>/agent-computer/<userSegment>/profile --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 --disk-cache-size=… about:blank`.
  - Read the port from `DevToolsActivePort`.
  - Supervise the process: on exit, mark it dead and restart on next use.
  - Profile dir mode is 700, and it lives outside `bot-workspaces/`.
- **`ensureBotSession(bot)`**: the server issues the session's first command (`agent-browser --session <botSegment> --cdp <port> --pin-tab open about:blank`), so the pin binding always exists. On `tab_gone`, rebind a fresh tab.
- **Idle handling:**
  - After 10 minutes idle, close the bot's tab.
  - Kill the user's browser when it has no tabs left.
  - A pending handoff, a pending secret request or an open live view counts as activity.
- **Memory budget:**
  - Charge about 500 MB for a user's browser and about 120 MB per extra tab, against `os.totalmem() − 1.2 GB`.
  - Optional override: `EIDON_BROWSER_MEMORY_BUDGET_MB`, added to the zod schema in `lib/env.ts`.
  - When the budget is exhausted, the request waits, reusing the waiter pattern of `acquireBotUserSlot` in `lib/bot-run-limiter.ts`. After a bounded wait, the bot gets "browser busy".

**Changes to existing files:**
- **`lib/bot-sandbox.ts` `resolveBotSandbox`:**
  - Env becomes the per-bot `AGENT_BROWSER_SOCKET_DIR`, `AGENT_BROWSER_SESSION=<botSegment>`, the CDP/pin settings, and `AGENT_BROWSER_IDLE_TIMEOUT_MS`.
  - **Drop `AGENT_BROWSER_SESSION_NAME`.**
  - Called from `executeShellCommand` (`lib/tool-executors.ts:885-892`) after `ensureBotSession`.
- **`lib/local-shell.ts`:** extend `SHELL_ENV_EXTRA_ALLOWLIST` with the new vars.
- **Bot delete** (`lib/bots.ts:402-403`): close that bot's tab. The user profile is kept.
- **`app/api/bots/[botId]/reset-browser-session/route.ts`:** becomes "sign out of every site for all your bots": stop the user's browser and wipe the profile. Update the UI copy.
- **Startup cleanup:** delete `…/home/.agent-browser/sessions/bot-*.json`, via `lib/runtime-bootstrap.ts`.
- **`lib/db-builtin-skills.ts`:**
  - Drop "Always close the browser when done".
  - Add guidance on `request_takeover` / `request_secret` / `use_credential` (the tools arrive in later PRs, so land that text with them).
  - Add "never ask for passwords in chat".

**Tests:**
- `tests/unit/agent-computer.test.ts`, with Chromium and agent-browser spawns mocked: launch, port read, restart, idle, budget, rebinding.
- Extend `tests/unit/bot-sandbox.test.ts`, `local-shell.test.ts` and `bot-run-limiter.test.ts`.

### Prerequisite (on branch `Quack6765/bot-interactive-approvals`, before merge): `waiting_user`
- Rename the status in every file the branch touches:
  - `lib/bot-runs.ts`, `lib/bots.ts`, `lib/bot-delegation.ts`
  - `lib/db-migrations.ts`
  - `components/agents/bot-status.tsx`, `hooks/use-delegation-status.ts`
  - both contract files and their tests.
- Merge that branch before PR 3.

### PR 2: Live view, read-only
- **`lib/agent-computer.ts` (relay part):**
  - Per bot: one upstream connection to the session's stream (port from `agent-browser stream status --json`), opened while at least one viewer is present.
  - Fan-out to viewers: binary JPEG, plus JSON `status`, `url`, `tabs` and the current action caption.
  - Latest frame only; skip a viewer while its `bufferedAmount` is above about 256 KB; per-viewer fps cap (web 15, mobile 8). Use the stream's `maxFps` / quality settings where they help.
  - Authorization: only the bot's owner.
- **Transport:**
  - `server.cjs:115-122` gets a second `WebSocketServer` for `/ws/computer` and `/api/v1/ws/computer`.
  - `lib/ws-upgrade-router.ts` `resolveWebSocketAuthMode` learns the mobile path.
  - The auth code in `lib/ws-handler.ts` (`extractToken`, `extractBearerToken`, `verifySessionToken`, `verifyMobileSessionToken`) is reused, not duplicated.
  - New `lib/computer-protocol.ts` holds the message schema.
- **The caption** comes from the running `shell_command` action label (the "Web browser" label from `getShellCommandLabel`).
- **API:** `GET /api/bots/[botId]/computer` returns status (running, url, controlOwner, isolation). It is mounted in `app/api/v1/[...path]/route.ts`.
- **UI:** a live view in the existing **"Browser" `PanelSection`** of `components/agents/bot-detail-view.tsx:649`, via a new `components/agents/agent-computer-panel.tsx` and a `hooks/use-agent-computer.ts`.
  - UI work starts with the design-direction gate: impeccable context, Mobbin references, and your choice on the decision page. No visual direction is locked in this plan.
- **Contracts:**
  - OpenAPI: the GET operation.
  - WebSocket schema: the computer-socket messages.
  - Update `tests/unit/mobile-contracts.test.ts:147+` (path list) and the `:293-294` counts.
  - The PR notes that native clients must regenerate.
- **Tests:** relay unit tests (fan-out, backpressure, auth, fps cap) and router tests.

### PR 3: Take control / return control (depends on the approvals merge)
- **Gate:** extract the generic user gate from `waitForToolApprovalDecision` in `lib/tool-approvals.ts`. That covers the settle registry, timeout, abort and DB adoption, with `onWaitChange` and `lib/pausable-timeout.ts` reused. `tool_approval`, `computer_handoff` and `secret_request` all use it.
- **Types:** `lib/types.ts` `MessageActionKind` gains `computer_handoff` and `secret_request`.
- **Tool `request_takeover({reason})`:**
  - Added in `buildToolDefinitions` (`lib/tool-definitions.ts:35`) for bot conversations.
  - Also added in `buildCopilotTools` (`lib/copilot-tools.ts:25-43`), which builds its own list.
  - Dispatched in `executeToolCall` (`lib/tool-executors.ts:1439`).
  - Waits 30 minutes, then returns "User completed the step and returned control. Note: …".
- **Taking control when the bot didn't ask:** `POST /api/bots/[botId]/computer/control {action:"take"|"return", note?}`.
  - While the user holds control, `executeShellCommand` refuses commands labelled "Web browser" with a clear message. Other tools keep running.
- **Relay:** accepts input only from the owner while `controlOwner==="user"`. It clamps coordinates, rate-limits, always fills in the key `code`, and maps Cmd→Ctrl.
- **Card:** `components/computer-handoff-card.tsx`, rendered from `renderAssistantActionItem` (`components/message-bubble.tsx:793`) next to the `isToolApprovalAction` branch (:832). The live view gets Take control / Return control.
- **Contracts:** control operation, action kind, and input messages.
- **Tests:** gate extraction (the existing tool-approval tests must still pass), executor guard, control route, relay input authorization.

### PR 4: Secure secret request + saved credentials
- **Tool `request_secret({label, origin, target, save?})`** creates a `secret_request` card with no value in its payload.
- **Submitting:** new `POST /api/message-actions/[actionId]/secret {value, save}` over HTTPS. The body is never logged or echoed. It is not sent over `/ws`.
- **Fill:** the server checks that the bot tab's current origin equals `origin`, focuses `target`, and **types the value through the stream's `input_keyboard`**. Nothing goes into argv, temp files or the model.
- **Redaction:** for the rest of the run, tool outputs (shell, snapshot, eval) are scrubbed of the exact value and its base64 and URL-encoded forms before they reach the model or `message_actions`.
- **Saved credentials:**
  - New `user_credentials` table in `lib/db-migrations.ts`, scoped to the user and origin, since the browser is per user. Values are encrypted with `encryptValue` / `decryptValue` from `lib/crypto.ts`.
  - Tool `use_credential({name|origin, target})` fills the saved value through the same server path with no prompt (same-origin only).
  - A small list with delete in Settings.
- **Card:** `components/secret-request-card.tsx` (masked, `autocomplete=off`), rendered in `renderAssistantActionItem`.
- **Skill text** for the three tools.
- **Contracts:** secret operation, credential list/delete operations, action kind.
- **Tests:**
  - Origin mismatch is rejected.
  - Redaction.
  - The value never appears in `message_actions`, logs or tool results (assert over the DB rows).
  - Crypto round-trip.

### PR 5: iOS client
The native client builds against the updated contract: frames in an image view, tap→click, drag→scroll, a hidden text field for keys, the handoff and secret sheets. Built and tested with XcodeBuildMCP.

### PR 6: Hardening (Landlock + egress proxy)
- **`scripts/landlock-exec.py`:** about 40 lines, `python3` + `ctypes`, syscalls 444/445/446. It probes the ABI, applies the ruleset, sets no-new-privs and execs. Two profiles:
  - **shell:** read-only system paths; read-write only the bot workspace and tmp; no access to `agent-computer/`, the DB, `.env` or other socket dirs; TCP connect only to the proxy port.
  - **browser:** filesystem rules only, applied when `ensureUserBrowser` spawns Chromium.
- **Where it's applied:** wrap the spawn in `executeLocalShellCommand` for bot runs. Copy the script in the `Dockerfile`.
- **New `lib/egress-proxy.ts`:** an HTTP CONNECT proxy on a loopback port inside the Node server.
  - Rejects loopback (including `:3000`), RFC 1918, link-local and metadata, CGNAT and IPv6 ULA.
  - Checks again after DNS resolution and after every redirect.
  - Chromium gets `--proxy-server` and `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.
- **Settings status:** "Browser isolation: active / unavailable (kernel lacks Landlock)" in `components/settings/sections/general-section.tsx`, following `semantic-recall-settings.tsx` (fetch a status route). Also a badge in the bot's Browser panel.
- **Tests:** launcher argument building (with the Landlock probe mocked), proxy allow/deny matrix including redirects and rebinding.

### Later (not in this plan)
- Teach a task: record the relay's input and url events plus a sampled frame per step, up to 10 minutes, then draft a skill. **No `ffmpeg`.**
- An optional isolated profile for individual bots.
- An optional browser sidecar.

## Verification
- **Every PR:**
  - `npm test` (Vitest with v8 coverage, 85 % thresholds on `lib/**`), lint and typecheck, all run by me.
  - Then I hand off test notes to you. You do the manual testing. Safari checks are yours.
- **Contract PRs:** the counts and path list in `tests/unit/mobile-contracts.test.ts` are updated, and each PR description carries a "native clients must regenerate" note.
- **Manual flows for your handoff notes:**
  1. Two bots browse at once and each stays on its own page.
  2. Watch the live view.
  3. The bot asks for 2FA: take control, type, return, and the bot resumes.
  4. Take control mid-run: the bot's browser commands are refused until you return control.
  5. A secret request fills the field, and the value is absent from the transcript and the model's context.
  6. A saved credential is reused on the same site.
  7. An idle bot's tab closes after 10 minutes, and its logins survive.
  8. `reset-browser-session` signs out every site.
- **Image checks:** image size compared with the current 1.44 GB compressed (expect a small decrease); `agent-browser --version` returns 0.38.1; no new apt packages in the diff.

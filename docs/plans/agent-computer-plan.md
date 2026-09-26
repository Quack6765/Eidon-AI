# Agent Computer for bots: official plan

## Context

**The gap.** Bots browse through the `agent-browser` CLI via `execute_shell_command`. Users cannot:
- watch that browser;
- step in for a login, 2FA, CAPTCHA or payment;
- hand over a secret safely.

**The goal.** Grok Bot's "Agent Computer": a live view, take control and return control, secure secret requests, and saved credentials. It must add no heavy layer and must not bloat the Docker image.

**Groundwork.**
- Analysis: `docs/plans/agent-computer-analysis.md` (`65c787f9`, `253a96ae`).
- This file replaces the earlier draft (`7deb7bd0`).
- This plan was **revalidated on 2026-09-26 against local `dev` at `aa637084`**, which equals `origin/dev` and is 53 commits past this branch's base `7816c855`. All line refs below are on `aa637084`.

**Key finding.** The agent-browser stream server already in the image provides frames and input. Input reaches the next frame in 41 ms (measured). The plan adds no apt packages, and trimming unused binaries saves about 60 MB.

## Locked decisions (confirmed by the user)

| Topic | Decision |
|---|---|
| Base image | `node:24-bookworm-slim`; `agent-browser@0.38.1` pinned (still latest); `better-sqlite3` → 12.11.1 |
| Browser model | One shared Chromium + profile **per user**, one pinned tab per bot. Never shared across users |
| Live view | The server relays each bot's loopback agent-browser stream over a new WS path on the existing server, with the same auth |
| Pause / resume | One generic user gate taken from the tool-approval gate, for `tool_approval`, `computer_handoff` and `secret_request`. `draft_message` stays outside it (non-blocking by design) |
| Run status | `waiting_approval` → `waiting_user`. It's in no release (latest is v4.1.0), so it is renamed on `dev` before the next release |
| Handoff and secret timeout | 30 min, independent of the 5 min DM and 24 h unattended approval timeouts; the tab stays alive while waiting |
| Saved credentials | Ship with the secrets PR; same-origin reuse needs no prompt |
| Isolation | Landlock + in-process egress proxy (0 MB). Warn, not refuse, without Landlock. No uid split, no sidecar |
| Availability / scope | On for every bot, with a memory budget. Browser-only view |
| iOS | Not in this plan. A separate agent's PR uses the `sync-parity` skill. These PRs keep the contracts complete and list their native-facing changes |

## Revalidation against `dev` `aa637084`

**Unchanged since the base, so those claims hold:**
- `Dockerfile`, `package.json`, `.github/workflows/test.yml`, `docker-compose.native-test.yml`
- `lib/copilot-tools.ts`, `lib/bot-run-limiter.ts`, `lib/ws-upgrade-router.ts`, `lib/ws-send.ts`
- `lib/compaction-turns.ts`, `lib/semantic-index.ts`, `lib/db-builtin-skills.ts`, `lib/env.ts`, `lib/crypto.ts`, `components/tool-approval-card.tsx`

The measured facts also still hold:
- stream and input protocol, memory numbers, no apt packages needed;
- Landlock works while bwrap, userns and the Chromium sandbox fail;
- the shared plaintext `bot-bot.json`, and logins lost on `close`;
- the image is stuck on 0.27.0;
- 0.38.1 reads `AGENT_BROWSER_CDP`, `AGENT_BROWSER_PIN_TAB` and `AGENT_BROWSER_EXECUTABLE_PATH` from env (`cli/src/flags.rs:559,562,603`), so the `agent-browser-core` wrapper (`Dockerfile:38-40`) can go.

**Facts that shape the plan:**
1. **Non-bot chats share one browser across users.** They still get no `AGENT_BROWSER_*` env (`lib/tool-executors.ts:854-867`, `lib/local-shell.ts:7-44`).
2. **#344 merged** (`87905548`). Bots are interactive now: `unattended: !bot && …` (`lib/chat-turn.ts:336-346`). Bot DMs get the 5-minute default and unattended bot runs get 24 h.
3. **WS viewers still miss card resolutions.** `broadcastToolApprovalUpdate` (`lib/tool-approvals.ts:514-524`) only emits to the SSE chat emitter. The fix pattern already exists in `broadcastMessageDraftUpdate` (`lib/message-drafts.ts:142-152`) and `lib/bot-runs.ts:252-256`: `getConversationManager().broadcast(conversationId, {type:"delta", …action_complete})`.
4. **#350 moved restart handling into `lib/interrupted-work.ts`.**
   - Delegated runs are **requeued** (:79-85), and other bot runs become **stopped** (:86-94), not failed.
   - Pending `tool_approval` cards are resolved as stopped (:108-119).
   - The resume notice lists cancelled approvals, filtered by kind (:188-190).
   - `resumeRuntimeWork` is started from `server.cjs:206`.
5. **#353 added two generic signals and run control.**
   - A generic `waitingForInput` flag (`lib/bots.ts:540,620`: any pending card) and `botAttentionLabel` (`components/agents/bot-status.tsx:31-37`).
   - `getBotStatus` returns `waiting_approval` only for `ma.kind='tool_approval'` (`lib/bots.ts:516-520,541`).
   - Run stop goes through `stopConversationWork` → abort (`lib/bot-runs.ts:282-298`), which fires the gate's `handleAbort` (`lib/tool-approvals.ts:725-732`).
   - Redirects apply only at step boundaries (`lib/assistant-runtime.ts:574-579`), so a message typed during a handoff waits until the tool returns.
6. **#354 drafts** (`draft_message`, `lib/message-drafts.ts`) are a pending card with no wait machinery. They resolve outside the turn, so they stay out of the gate. `loadMessageDraftAction` (:91-140) nearly duplicates `loadPendingToolApprovalAction`, so a shared `loadPendingAction(kind)` helper is worthwhile.
7. **#351 added a shared team workspace.**
   - `bot-workspaces/<owner>/shared` (`lib/bot-sandbox.ts:19-30`, created in `resolveBotSandbox` :58-77) is writable by every bot of the same owner.
   - Docker's `HOME` and `TMPDIR` live inside the data volume, and `HOME` is shared across all users (`Dockerfile:25-27`).
8. **Redaction must happen before persistence.** Shell `resultSummary` is replayed into prompts (`lib/compaction.ts:220-236,324-344`) and summarised into indexed `memory_nodes` (`lib/compaction-turns.ts:49-94`).
9. **Mobile sanitiser strips keys.** It removes `credentials`, `token`, `headers`, `env` and now `sourcePath` (`lib/mobile-api.ts:22-50`), so the saved-login API uses `savedLogins`.
10. **Transport constraints:**
    - The computer socket needs its **own** `WebSocketServer({noServer:true, maxPayload, perMessageDeflate:false})`, because `setupWebSocketHandler` binds chat to its whole WSS (`lib/ws-handler.ts:117,126`).
    - `resolveWebSocketAuthMode` matches only `/api/v1/ws` exactly (`lib/ws-upgrade-router.ts:20-23`).
    - `extractToken`/`extractBearerToken` (`lib/ws-handler.ts:104-115`) aren't exported.
    - There is no Origin check anywhere.
    - `sendWebSocketData` closes the socket above 1 MB buffered (`lib/ws-send.ts:3-17`).
    - The client `lib/ws-client.ts:37` is a hardcoded `/ws` singleton.
11. **Production still has no SIGTERM/SIGINT handler** (`server.cjs:159-163`; dev only at :130-156).
12. **Caption source.** It must come from the action's `detail`; the label is always "Web browser".
13. **Copilot tools.** Bot-only tools never reach Copilot (`lib/copilot-tools.ts:27-43`), so new tools are added there explicitly.
14. **Hardening must come before saved credentials.** Without Landlock, a bot shell can read `eidon.db` and `/proc/1/environ` (`EIDON_ENCRYPTION_SECRET`).
15. **Shell ceiling.** The shell timeout ceiling is now 10 min, with a process-group kill (`lib/local-shell.ts:101,237-254`). The Landlock wrapper must exec in place so the kill keeps working.
16. **Node 24 native modules:**
    - `better-sqlite3` 11.10.0 fails on Node 24; 12.11.1 works on arm64 and amd64 (measured).
    - `argon2` 0.41.1 is N-API.
    - `sherpa-onnx-node` needs a smoke test.
17. **Contract state:**
    - 77 OpenAPI paths; request bodies 43 and responses 123 (`tests/unit/mobile-contracts.test.ts:325-326`); path list at :147-187.
    - `Action.kind` enums: openapi :403, ws :131, proposal payload anyOf ws :144.
    - Status enums: openapi :413-414, ws :281,299.

## Delivery: PRs in order (all target `dev`, start from current `dev`, and carry their own contract changes)

### PR A: `waiting_user` rename + WS broadcast of resolved cards
- **Status value** (`waiting_approval` → `waiting_user`):
  - `lib/types.ts:162,194`
  - `lib/bot-runs.ts:30,182-183,240`
  - `lib/bots.ts:518,520`
  - `lib/interrupted-work.ts:83,92`
  - `lib/bot-delegation.ts:616,627`
  - `components/agents/bot-runs.tsx:16,41,55`
  - `components/agents/bot-status.tsx:19,32,48,54,92`
  - `hooks/use-delegation-status.ts:149`
  - contracts (openapi :413-414, ws :281,299)
  - about 13 test files
- **Helpers:** `setBotRunAwaitingApproval` (`lib/bot-runs.ts:180`) → `setBotRunWaitingForUser`, `setTurnAwaitingApproval`/`awaitingApproval` (`lib/turn-activity.ts:13,106,135`) → `…WaitingForUser`, `onApprovalWait` (`lib/chat-turn.ts`, `lib/bot-delegation.ts`) → `onUserWait`. `automation-scheduler` no longer has this hook, so it isn't touched.
- **Label:** "Needs approval" stays for tool approvals. It becomes kind-aware in PR 3.
- **Broadcast:** extract a shared `broadcastActionUpdate(action)` from the `lib/message-drafts.ts:142-152` pattern, and use it in `broadcastToolApprovalUpdate` and in the drafts code.
- **Legacy rows:** `lib/interrupted-work.ts:79-94` matches both `'waiting_user'` and legacy `'waiting_approval'`, so dev-image rows get requeued or stopped. There's no CHECK constraint, and no separate migration.
- **PR description:** the contract enum changed, so native clients must regenerate.

### PR 0: Node 24 + agent-browser
- **`Dockerfile`:**
  - `FROM node:24-bookworm-slim`.
  - `npm install -g agent-browser@0.38.1`.
  - Delete the non-matching `bin/agent-browser-*` binaries.
  - Remove the `agent-browser-core` wrapper.
  - Add `ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`, and put it in `SHELL_ENV_ALLOWLIST` (`lib/local-shell.ts:7-18`).
- **Packages and CI:**
  - `better-sqlite3` `^12.11.1`, `@types/node` `^24`.
  - `.github/workflows/test.yml:16` → 24.
  - `docker-compose.native-test.yml:3` → `node:24-alpine`.
- **Tests:** update `tests/unit/dockerfile.test.ts:17-29`.
- **Verify in CI:**
  - The image builds.
  - `agent-browser --version` returns 0.38.1.
  - A no-flag `open` prints no warning.
  - Smoke-load `better-sqlite3`, `argon2`, `sharp`, `onnxruntime-node` and `sherpa-onnx-node`.

### PR 1: Browser host (shared per-user browser, persistence, memory budget)
- **New `lib/agent-computer.ts`** (state in a `globalThis[Symbol.for(…)]` registry, exported through `lib/ws-handler.ts:90-102`):
  - **`ensureUserBrowser(userId)`**:
    - Spawns `/usr/bin/chromium --headless=new --no-sandbox --disable-dev-shm-usage --user-data-dir=<EIDON_DATA_DIR>/agent-computer/<userSegment>/profile --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 --disk-cache-size=…`.
    - Reads `DevToolsActivePort`.
    - Supervises the process; the profile dir is mode 700, outside `bot-workspaces/`, and never added to attachment roots.
  - **`ensureBotSession(bot)`**: the server issues the first `agent-browser --session <botSegment> --cdp <port> --pin-tab open about:blank`, and rebinds on `tab_gone`.
  - **Idle:** close a bot's tab after 10 min idle; kill the browser when it has no tabs. A pending gate or an open viewer counts as activity. The hook is the `finally` block of `startAssistantTurn` (`lib/chat-turn.ts:783-808`).
  - **Memory budget:**
    - Charge 500 MB per browser and 120 MB per extra tab, against `os.totalmem() − 1.2 GB`.
    - Override with `EIDON_BROWSER_MEMORY_BUDGET_MB` in the zod schema (`lib/env.ts:23-43`).
    - A weighted waiter follows the `acquireBotUserSlot` pattern (`lib/bot-run-limiter.ts:43-72`); after a bounded wait the bot gets "browser busy".
  - **Shutdown:** add production SIGTERM/SIGINT handling in `server.cjs` that stops the browsers and runs `shutdownAllProcesses`.
- **`resolveBotSandbox`** (`lib/bot-sandbox.ts:58-77`):
  - Env becomes the per-bot socket dir, `AGENT_BROWSER_SESSION=<botSegment>`, `AGENT_BROWSER_CDP`, `AGENT_BROWSER_PIN_TAB=1` and `AGENT_BROWSER_IDLE_TIMEOUT_MS`.
  - **Drop `AGENT_BROWSER_SESSION_NAME`**, and add the matching `SHELL_ENV_EXTRA_ALLOWLIST` entries (`lib/local-shell.ts:20-24`).
  - `executeShellCommand` calls `ensureBotSession` before `resolveBotSandbox` (`lib/tool-executors.ts:854-857`).
- **Non-bot chats:** a per-user pinned session (`AGENT_BROWSER_SESSION=user-<userSegment>`) in that user's browser.
- **Bot delete** (`lib/bots.ts` `deleteBot` → `removeBotBrowserSession`, `lib/bot-sandbox.ts:50-56`): close only the bot's tab.
- **Reset:** `reset-browser-session` wipes the user's profile ("sign out everywhere for all your bots"), with new copy in the Browser section (`components/agents/bot-detail-view.tsx:742-763`, `handleReset` :393).
- **Startup:** `bootstrapRuntimeState` (`lib/runtime-bootstrap.ts`) deletes `…/home/.agent-browser/sessions/bot-*.json`.
- **Skill text:** drop "Always close the browser when done" (`lib/db-builtin-skills.ts:50`) and add "never ask for passwords in chat".
- **Tests:**
  - New `tests/unit/agent-computer.test.ts`, with spawns mocked.
  - Update the pinned tests: `tests/unit/bot-sandbox.test.ts:33-34`, `local-shell.test.ts:416-468`, `shell-workspace.test.ts:83-102`, `shell-command-executor.test.ts:68,74`.

### PR 2: Live view (read-only)
- **Relay** (in `lib/agent-computer.ts`):
  - One upstream client per bot (port from `agent-browser stream status --json`), only while there are viewers. Pattern: `lib/speech/soniox.ts:53-130`.
  - Fan-out as binary JPEG plus JSON `status`, `url`, `tabs` and a caption built from the running action's `detail`.
  - Latest frame only; skip a viewer while its `bufferedAmount` is above 256 KB; fps cap 15 on web, 8 on mobile, using the stream's `maxFps`/quality.
- **Transport:**
  - A second `WebSocketServer` in `server.cjs`, with `"/ws/computer"` and `"/api/v1/ws/computer"` added to the map at :122.
  - Its own auth-mode resolution for the mobile path, with `tests/unit/ws-upgrade-router.test.ts` extended.
  - Export and reuse `extractToken`/`extractBearerToken`/`verify*SessionToken`, including the `getCurrentUser` fallback.
  - An Origin check, and HTTPS for mobile in production.
  - Owner-only.
  - The message schema lives in `lib/types.ts` (`ComputerState`) and the WebSocket contract.
- **API:** `GET /api/conversations/[conversationId]/computer` (live, url, caption, viewport), mounted in `app/api/v1/[...path]/route.ts`. Addressing is by conversation, so the same view serves a bot's thread and a regular chat (which uses its owner's session); the socket takes `?conversationId=`.
- **Client:** new `hooks/use-computer-stream.ts`, which owns its own socket, backoff and cleanup. The `/ws` singleton can't be reused. The chosen UI is a live card in the thread (`components/computer-session-card.tsx`).
- **UI (behind the design-direction gate):** impeccable context → Mobbin → your choice on the decision page. Constraint from the revalidation: the right aside is `lg:w-[320px]`, too narrow for a usable view. Candidates to present:
  - an alternate main pane that swaps with ChatView in the `bot-detail-view.tsx:571-578` slot, with a "Live" toggle next to Details (:530);
  - or an overlay.

  The Browser section (:742-763) keeps status, reset and saved logins.
- **Contracts:** add the GET operation and the socket messages; update the path list (`tests/unit/mobile-contracts.test.ts:147-187`) and the counts (43 / 123 plus the new ones); note that native clients must regenerate.
- **Tests:** relay (fan-out, backpressure, owner auth, Origin, fps cap) and the router.

### PR 3: Take control / return control
- **Gate:** extract the generic user gate from `lib/tool-approvals.ts`: the registry (:478-512), the wait skeleton (:673-750) and the `onWaitChange` bracket (:665-670). Use the shared `loadPendingAction(kind)` and `broadcastActionUpdate`. It serves `tool_approval`, `computer_handoff` and `secret_request`; drafts stay separate. The 30 min timeout is passed explicitly.
- **Kinds:** `lib/types.ts:93` and the `ProposalPayload` union (:499-503); openapi :395,403; ws :67,131 plus new `$defs` and the anyOf at :144.
- **Status and attention:**
  - Widen `PENDING_TOOL_APPROVAL_CONDITION` (`lib/bots.ts:541`) to the three gate kinds; don't use the any-pending condition, since drafts match it too.
  - Make `botAttentionLabel` (`bot-status.tsx:31-37`) kind-aware: "Needs approval" versus "Waiting for you".
- **Restart:**
  - `lib/interrupted-work.ts:108-119` resolves the new kinds as stopped, each with its own summary.
  - The resume-notice filter (:188-190) includes them, so the resumed bot asks again. The live session and any in-memory secret are gone after a restart.
- **Tool `request_takeover({reason})`:**
  - Registered in `buildToolDefinitions` (`lib/tool-definitions.ts:35`, next to the `botTeam` block at :271) and in `buildCopilotTools` (`lib/copilot-tools.ts:25`), gated on bot conversations.
  - Dispatched in `executeToolCall` (`lib/tool-executors.ts:1514`).
  - Returns "User completed the step and returned control. Note: …". The note is the tool result, not a redirect.
- **User-initiated control:** `POST /api/conversations/[conversationId]/computer/control {action:"take"|"return", note?}`.
  - While the user holds control, `executeShellCommand` refuses "Web browser" commands before `onActionStart` (`lib/tool-executors.ts:845`).
  - Stop or abort (`stopConversationWork`) resets `controlOwner` and closes control mode.
  - The composer shows that messages typed during a handoff are queued until control returns.
- **Relay input:** owner-only while `controlOwner==="user"`; clamp coordinates and rate-limit; always fill `code`; map Cmd→Ctrl.
- **Card:** `components/computer-handoff-card.tsx`, following the draft-card template in `components/message-bubble.tsx`:
  - a guard plus the card;
  - kept in place in the thread (not deferred), so a resolved hand-off reads as history where the bot paused, and excluded from the status-line insertion index;
  - a branch after the tool-approval branch, rendered during streaming;
  - the conversation id is threaded through `streaming-message.tsx` and `chat-view.tsx` for every message, so a pending hand-off can be taken after a reload.

  Visuals follow the chosen "Live card in the thread" direction: "Take control" on the live card and "Take over" on the hand-off card open a full-screen stage with a control strip (note, Return control, Minimize). Control goes back to the bot when the user returns it or stops watching, unless the bot asked for the hand-off.
- **Tests:** the existing tool-approval, bot-tool-approvals and interrupted-work tests still pass; plus the executor guard, the control route, input authorisation, restart reconciliation of the new kinds, and the attention label.

### PR 4: Hardening: Landlock + egress proxy (before secrets)
- **New `scripts/landlock-exec.py`** (`python3` + `ctypes`, syscalls 444/445/446): probes the ABI, applies `--ro`/`--rw`/`--dev` path rules and `--connect` port rules, sets no-new-privs, then execs **in place** (fact 15), so the shell's process-group kill keeps working. It fails closed (exit 126) when Landlock is missing or its rules are malformed; the server only wraps commands when the probe found Landlock. On ABI 6 and later it also scopes signals and abstract unix sockets.
- **`lib/shell-isolation.ts`** caches the probe, reports `active` (ABI ≥ 4) / `filesystem` (ABI 1–3) / `unavailable`, and builds the launcher command. Read-only paths are the system dirs plus `PATH` and the Node prefix, never anything inside or above the data dir.
- **Three sandboxed processes**, each with the same filesystem allow-list and its own TCP allow-list:
  - **bot shell:** read-write on the bot's own workspace, `bot-workspaces/<owner>/shared`, a per-bot `HOME` (`<data>/bot-homes/<owner>/<bot>`, kept outside the workspace so it doesn't clutter the Files tree), its own socket dir, `$TMPDIR` and `/tmp`; TCP connect only to the proxy port. It also gets `HTTP(S)_PROXY` and `NODE_USE_ENV_PROXY=1`.
  - **bot's agent-browser daemon** (started by the server): the same filesystem rules, TCP connect only to the owner's CDP port. Without this, the daemon would be a confused deputy: `agent-browser screenshot /app/data/eidon.db` or `upload … /app/data/.env` would run outside the sandbox, and `agent-browser connect <port>` could reach another user's browser.
  - **Chromium:** read-write only on the user's profile, a per-user browser `HOME` and the scratch dirs; TCP connect only to the proxy port.
- **Socket dirs are unguessable.** Landlock (through ABI 6) does not mediate `connect()` on pathname unix sockets, so another bot's daemon socket was reachable by path. Socket dir names are now an HMAC of the bot or user id with a per-boot random key, and boot removes socket dirs whose daemon no longer runs. A dead daemon is rebound by the server (never respawned from inside a sandboxed shell) and its old tab is closed.
- **New `lib/egress-proxy.ts`:** one HTTP/CONNECT proxy per server on loopback.
  - Denies loopback (including the app port), RFC 1918, link-local and metadata, CGNAT, IPv6 ULA and link-local, NAT64 and IPv4-mapped forms of those, and hostnames that resolve to any of them. It connects to the address it checked, so DNS rebinding can't swap it; redirects come back through the proxy and are checked again.
  - Chromium gets `--proxy-server`, `--proxy-bypass-list=<-loopback>` (Chromium otherwise bypasses the proxy for loopback) and `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.
  - Behavior change: bots and the browser can no longer reach the local network or the Eidon server itself.
- **Settings status:** a "Bot sandbox" card (Active / Files only / Unavailable) in Settings → General → Bots, following the semantic-recall card. The server page passes it as a prop, so no API or contract change. No badge on the bot page, which would need an API field.
- **Known limits:** without ABI 6 (kernel 6.12) a sandboxed shell can still signal other processes of the app user, including the server; UDP (DNS) is not filtered; regular (non-bot) chat shells stay unsandboxed, as before.
- **Tests:**
  - Launcher arguments and probe caching, with the probe mocked; the launcher's own fail-closed argument handling.
  - Proxy allow/deny matrix, CONNECT and plain HTTP forwarding, hop-by-hop header stripping, hostnames that resolve to private addresses.
  - Host: Chromium and the daemon get their rules and proxy flags; dead daemons are rebound; stale socket dirs are cleared.
  - An image integration check: a sandboxed shell cannot read `/proc/1/environ`, `eidon.db` or another bot's workspace or socket dir, and cannot connect to the CDP port. It can still write to `shared/`, and the process-group kill still works.

### PR 5: Secure secret request + saved credentials
- **Tool `request_secret({label, origin, target, save?})`:** a `secret_request` card whose payload never carries the value.
- **Route:** its own `POST /api/message-actions/[actionId]/secret {value, save}`, not the drafts `fields` body, which is persisted. It is mounted after `app/api/v1/[...path]/route.ts:130-131`. The body is never logged or echoed.
- **Fill:** check that the tab origin equals `origin`, focus `target`, then type the value through the stream's `input_keyboard`. No argv, no temp file, nothing sent to the model.
- **Redaction:** for the rest of the run, scrub the exact value and its base64 and URL-encoded forms from `resultSummary`, `detail` and `arguments`. Do it right after `summarizeShellResult` (`lib/tool-executors.ts:869`) and **before** `onActionError`/`onActionComplete` (:875-898); the same applies to snapshot and eval output.
- **Saved credentials:**
  - A `user_credentials` (user, origin) table in `lib/db-migrations.ts`, encrypted with `encryptValue`/`decryptValue` (`lib/crypto.ts:9,22`).
  - `use_credential({origin, target})` fills same-origin credentials with no prompt.
  - Settings list and delete, with the API field `savedLogins`.
- **UI:** `components/secret-request-card.tsx` (masked, `autocomplete=off`), using the same card pattern as PR 3, behind the design gate.
- **Also:** skill text for the three tools, and contracts for the secret operation, saved logins and the action kind.
- **Tests:**
  - Origin mismatch is rejected.
  - Redaction happens before persistence.
  - The value is absent from `message_actions`, compaction input and tool results.
  - Crypto round-trip.
  - Restart drops pending secret requests.

### iOS client: out of scope
A separate agent's PR uses the `sync-parity` skill and covers everything merged to `dev` since the last `main` release. Every PR here updates both contracts and lists its native-facing changes, with the "native clients must regenerate" note.

### Later (not in this plan)
- Teach a task (relay input and URL events plus sampled frames, 10 min, no `ffmpeg`).
- An optional isolated per-bot profile.
- An optional sidecar.

## Status

- Locked on 2026-09-26, after revalidation against `dev` `aa637084`.
- `dev` was merged into `Quack6765/agent-computer-analysis`.
- The analysis doc was corrected to match.
- Implementation starts with PR A.

## Verification (every implementation PR)
- **Checks:**
  - `npm test` (Vitest, v8 coverage, 85 % thresholds on `lib/**/*.ts`), `npm run lint` and `npm run typecheck`, run by me.
  - Then test notes are handed to you. You run the manual and Safari checks; no QA agent.
- **Contract PRs:** path list and counts in `tests/unit/mobile-contracts.test.ts`, plus the "native clients must regenerate" note.
- **Manual flows:**
  1. Two bots browse at once and each stays on its own tab.
  2. Live view on the web app.
  3. The bot asks for 2FA: take control, type, return, and the bot resumes.
  4. Take control mid-run: browser commands are refused until you return control. Stopping the run exits control mode.
  5. A secret fill never appears in the transcript, a search or a compaction.
  6. A saved credential is reused on the same origin.
  7. An idle tab closes after 10 min and its login survives.
  8. `reset-browser-session` signs out everywhere.
  9. Restart during a handoff: the card shows stopped and the bot asks again after resume.
  10. The isolation status shows on hosts with and without Landlock.
- **Image:**
  - The compressed size is ≤ 1.44 GB (expect about −60 MB).
  - `agent-browser --version` returns 0.38.1.
  - No new apt packages.

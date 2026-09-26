# Agent Computer for bots: analysis

Status: analysis only. No app code changed. Date: 2026-09-25.
Reference product: xAI Grok Bot ([computer and apps](https://docs.x.ai/grok-bot/computer-and-apps), [approvals, security and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)).

## TL;DR

- **The live view and take control are already in the image.** The `agent-browser` binary we ship (0.27.0) starts a loopback WebSocket stream server for every session. The server sends CDP screencast JPEG frames plus `url`, `tabs` and `status` events, and it accepts `input_mouse`, `input_keyboard` and `input_touch` messages, which it forwards to `Input.dispatch*`. I measured this in the container. A click from the stream focused an input, typed keys landed, the wheel scrolled, and input reached the next frame in 41 ms.
- **Recommended architecture: add no packages.** The Eidon server connects to each bot's loopback stream and relays it over one new authenticated WebSocket path on our existing server. The web app and the iOS app draw the JPEG frames and send input back. Take control and secret requests reuse the pause/resume gate from `bot-interactive-approvals`.
- **Estimated image-size delta: +0 MB of apt packages.** Removing the six non-Linux `agent-browser` binaries we ship by accident saves about **60 MB**. An optional Landlock launcher, written in the `python3` we already ship, adds about 5 KB.
- **The real constraint is RAM, not disk.** One headless Chromium session measured about 430–490 MB PSS, and four separate browsers about 1.25–1.45 GB. Idle Eidon measured about 1.0 GB.
- **One shared browser per user, with a tab per bot, cuts that by about 43 %.** Four bots in one shared Chromium measured 821 MB, against 1,430 MB with a browser each. With it, a 2 GB box runs one user's browser with about three bot tabs instead of a single bot. Correct concurrent use depends on strict tab pinning (§7).
- **Decisions recorded (2026-09-25):**
  - Move the base image to **Node 24**, which unlocks agent-browser 0.38 and needs `better-sqlite3` 12.
  - Use a generic **`waiting_user`** run status.
  - **30-minute** handoff timeout.
- **The measurements turned up four problems that exist today, separate from this feature:**
  - The image is silently pinned to agent-browser 0.27.0. Version 0.28 and later need Node 24 or newer, and npm quietly falls back.
  - Every bot of every user writes browser cookies to **one shared plaintext file**.
  - Logins do **not** persist after `agent-browser close`.
  - Any bot's shell can drive another bot's browser over loopback.

## 1. What exists today (verified)

| Claim | Verified | Notes |
|---|---|---|
| Dockerfile installs `chromium`, `python3`, `agent-browser` wrapper | Yes, `Dockerfile:34-41` | The wrapper runs `exec agent-browser-core --executable-path /usr/bin/chromium "$@"`. Sockets live under `/app/data/runtime/agent-browser` (`Dockerfile:29`). |
| Browser use is a builtin skill driven through `execute_shell_command` | Yes, `lib/db-builtin-skills.ts:3-60` | The skill tells the bot "Always close the browser when done". Prefix-allowlisted as `agent-browser`. |
| `lib/local-shell.ts` runs `$SHELL -lc` with an env allowlist, 8k cap, 120 s browser timeout | Yes, `lib/local-shell.ts:7-44`, `:99-101`, `:196` | Only the three `AGENT_BROWSER_*` extras pass through. |
| Per-bot workspace and per-bot agent-browser session, with reset and workspace routes | Yes, `lib/bot-sandbox.ts:16-58`, `app/api/bots/[botId]/reset-browser-session`, `.../workspace` | Every bot uses `AGENT_BROWSER_SESSION=bot` and `AGENT_BROWSER_SESSION_NAME=bot`. Only the socket dir differs per bot. |
| No real isolation | Yes | Shell and Chromium run as `eidon`, the same uid as the server and the SQLite DB. Chromium runs with `--no-sandbox`, which agent-browser adds by itself (seen in the process cmdline). |
| Chat over WebSocket; mobile contract | Yes, `lib/ws-handler.ts`, `lib/ws-upgrade-router.ts`, `server.cjs:98-121` | The router matches exact paths (`/ws`, `/api/v1/ws`). `maxPayload` is 1 MB. |
| Per-user concurrency limit of 4 | Yes, `lib/bot-run-limiter.ts:3` | The limit is **per user**, not global. |
| Tool-approval pause | Branch `Quack6765/bot-interactive-approvals` @ `01a39eb4` | Covered in §4. |

### Measured baseline

Measurements used Colima on arm64 (2 vCPU, 2 GB RAM, kernel 6.8), which is a realistic small self-host box.

- **Published image** `ghcr.io/quack6765/eidon-ai:latest` (amd64 only):
  - **1.44 GB compressed**, about 3.7 GB unpacked.
  - Layers: `node_modules` 2.26 GB, `.next/standalone` 522 MB, **chromium + python3 + agent-browser 821 MB**, uv 55 MB.
  - I could not rebuild the full image locally. `next build` hit the V8 heap limit during type-checking on the 2 GB VM. Layer sizes therefore come from `docker history` of the published image and from a native rebuild of the browser layer (835 MB on arm64).
- **agent-browser in the image is 0.27.0** (published 2026-05-07). Latest is 0.38.1 (2026-09-16).
  - Every version from 0.28.0 on declares `engines.node >=24`. On the `node:22` base, `npm install -g agent-browser` quietly resolves to the newest compatible version, 0.27.0.
  - The package directory is 73 MB, because it ships prebuilt binaries for every platform and only `linux-<arch>` is used. Deleting the others saves about 60 MB.
- **Idle Eidon server:** about 1,041 MB PSS in `node` after startup, with the embedding model loaded. I measured the amd64 image under emulation, so treat this as approximate.

## 2. Live view: options compared

Sizes are Debian bookworm `Installed-Size` deltas on top of the packages the image already has. I computed them in a throwaway `node:22-bookworm-slim` container with `apt-get install -s` and `apt-cache show`. RAM and latency figures come from my prototype unless a source is cited.

| Option | Added packages | Added image size | CPU / RAM | Latency | Web app | iOS via our API | Verdict |
|---|---|---|---|---|---|---|---|
| **A. Relay agent-browser's built-in stream** (CDP screencast inside agent-browser) | none | **+0 MB** (−60 MB if the other-platform binaries are removed) | Encoding happens inside Chromium. A scrolling Wikipedia page used 12 % of 2 cores in total. The daemon is about 10–13 MB RSS | First frame 5–16 ms after connect; input to next frame **41 ms** | Yes (JPEG to `<img>`/canvas) | Yes (JPEG to `UIImage`; touch mapped to `input_mouse`/`input_touch`) | **Recommended** |
| B. Our own CDP `Page.startScreencast` client in Node | none (`ws` is already a dependency) | +0 MB | Same as A | Same as A | Yes | Yes | Duplicates A. We would need the CDP URL, and it competes with agent-browser's own screencast ("Screencast is already active", one per target). Keep only as a fallback. |
| C. Periodic screenshots (`agent-browser screenshot` or `Page.captureScreenshot`) | none | +0 MB | Each capture costs about 40–80 ms of CPU. Polling reaches about 5× fewer fps than screencast at the same settings ([glass benchmark](https://github.com/wanazhar/glass/blob/main/benchmarks/capture-report.md)) | 0.5–2 s | Yes | Yes | Acceptable as a status thumbnail. Not usable for take control. |
| D. Xvfb + x11vnc + noVNC + websockify (Debian packages) | 100 packages (`novnc` pulls in `nodejs`, `python3-numpy`, `net-tools`, …) | **+191 MB** | Headful Chromium plus an X server. Headful uses directionally about 60 % more RAM than headless ([Anchor](https://anchorbrowser.io/blog/choosing-headful-over-headless-browsers)). Framebuffer is about 4 MB at 1280×800 | noVNC is about 10–50 ms ([measurements](https://andri.yngvason.is/measuring-latencies.html)) | Yes (noVNC) | Poor: needs an RFB client in Swift, or a webview | Rejected on size and on iOS. |
| D′. Xvfb + x11vnc with noVNC's JS vendored | 19 packages | **+20 MB** plus about 1 MB of JS | Same as D | Same as D | Yes | Poor | Only worth it if native popups must be visible. |
| E. Headful Chromium in Xvfb with the stream from A | 5 packages (`xvfb`) | +7 MB | +RAM for headful | Same as A | Yes | Yes | Adds nothing to what the user sees: screencast still shows page pixels only. The only real gain is a less detectable headful fingerprint. Revisit only if headless gets blocked often. |
| F. Optional browser sidecar (for example `chromedp/headless-shell`) | separate image | +0 MB to the app image; about 143 MB compressed sidecar ([tags](https://hub.docker.com/r/chromedp/headless-shell/tags)) | One more container | Same as A | Yes | Yes | See §6. |

**Screencast limits we accept with A.** Native `<select>` popups, JS `alert`/`confirm`/`prompt`, permission prompts and file choosers are drawn outside the page and do not appear in frames ([select popups](https://github.com/microsoft/playwright/issues/13994), [Stagehand](https://github.com/browserbase/stagehand/issues/1238)). CDP events cover them: `Page.javascriptDialogOpening` / `handleJavaScriptDialog` and `Page.fileChooserOpened`. For v1 we don't need to draw native popups. The bot handles dialogs, and a takeover card can say "a dialog is open". Frames only arrive when the page changes, so a static page sends one frame.

### Measured stream numbers (agent-browser 0.27.0, Chromium 153, 1280×720 JPEG q80)

| Page | fps | avg frame | bandwidth |
|---|---|---|---|
| Mostly blank page with a 10 Hz text ticker | 12 | 6.2 KB | about 75 KB/s |
| Wikipedia while scrolling continuously | 13 | 131 KB | about 1.7 MB/s |

agent-browser's docs report 54 KB per frame at q80 on a busy 1280×720 page and about 9 KB at q20 at 640×360 ([streaming docs](https://github.com/vercel-labs/agent-browser/blob/main/docs/src/app/streaming/page.mdx)).

**Bandwidth has to be capped.** Version 0.27 ignores `?maxFps=`, which I tested. With the Node 24 decision, 0.38 supports `?maxFps=`, `pacing=ack` and `AGENT_BROWSER_STREAM_QUALITY/MAX_WIDTH` ([docs](https://github.com/vercel-labs/agent-browser/blob/main/docs/src/app/streaming/page.mdx)), so the source can be throttled directly. The relay still has to handle viewers with different needs:
- keep only the latest frame for each viewer;
- skip sending while `ws.bufferedAmount` is above about 256 KB;
- cap each viewer at a target fps (8 on mobile, 15 on web).

### Message format (0.27.0 source, [`cli/src/native/stream/websocket.rs`](https://github.com/vercel-labs/agent-browser/blob/v0.27.0/cli/src/native/stream/websocket.rs))

- **From agent-browser:**
  - `{"type":"frame","data":"<base64 jpeg>","metadata":{deviceWidth,deviceHeight,pageScaleFactor,offsetTop,scrollOffsetX,scrollOffsetY,timestamp}}`
  - `{"type":"status",…}`
  - `{"type":"tabs",…}`
  - `{"type":"url",…}` in newer versions.
- **To agent-browser:**
  - `input_mouse {eventType,x,y,button,clickCount,deltaX,deltaY,modifiers}`
  - `input_keyboard {eventType,key,code,text,windowsVirtualKeyCode,modifiers}`
  - `input_touch {eventType,touchPoints,modifiers}`
- **Gotchas found while prototyping:**
  - In 0.27, a key event **without `code` is dropped**: `null` gets forwarded to CDP. The relay must always fill in `code`.
  - The server binds `127.0.0.1` on an OS-assigned port and rejects browser `Origin`s that aren't localhost. It must never be exposed directly. Discover the port with `agent-browser stream status --json`.
- **Coordinate mapping:** `x_css = imgX × deviceWidth / jpegWidth / pageScaleFactor`, and the same for `y` with `offsetTop` subtracted. Read `jpegWidth` from the image itself, not from the metadata.

## 3. Recommended architecture

```
Bot shell ─ agent-browser CLI ─(unix socket)─ agent-browser daemon ─(CDP)─ Chromium (profile dir per bot)
                                                   │ loopback WS stream (frames ⇄ input)
                                                   ▼
                          Eidon server: lib/agent-computer.ts  (one relay hub per bot)
                           ├─ lifecycle: start / idle stop / global browser cap
                           ├─ fan-out: latest frame to each viewer, per-viewer fps cap
                           ├─ control owner: "bot" | "user"  (input accepted only from the user holding control)
                           └─ secret fill: types the value via input_keyboard; the value never enters argv, the DB or the model
                                                   │
             /ws/computer?botId=…      (cookie auth, web)       ← same upgrade router, same auth code
             /api/v1/ws/computer?botId=… (bearer auth, iOS)
```

**Why a separate socket path instead of multiplexing onto `/ws`:**
- Frames run from 75 KB/s to 1.7 MB/s. The chat socket carries snapshots, queue state and mobile payload sanitisation (`MAX_MOBILE_SNAPSHOT_BYTES`), and one busy view would add head-of-line delay to chat deltas.
- A dedicated socket is open only while the view is visible. It gets its own backpressure, and it can send JPEG as **binary** messages, which saves the 33 % base64 overhead, while status and control stay JSON text messages.
- It is still the same Node server, the same `routeWebSocketUpgrade`, and the same `verifySessionToken`/`verifyMobileSessionToken`. It is not a new layer.

**The server owns the browser lifecycle.** Today the first `agent-browser` command from the bot's shell starts the daemon. The server should start it instead. It would run `agent-browser --session … --profile <dir> open about:blank` with `AGENT_BROWSER_IDLE_TIMEOUT_MS`, before the first browser command of a run and whenever someone opens the live view. Three things follow from this:
1. The server always knows the stream port.
2. It enforces the global browser cap and the idle stop.
3. The daemon and Chromium run outside the bot shell's Landlock network rule (see §6), because agent-browser talks to Chromium over TCP CDP on a random loopback port.

**The live view is not only the browser.** "Current status" comes from the running shell action. Its label is always "Web browser" (`lib/tool-executors.ts`), so the caption is built from the action's `detail`, which holds the command: for example `agent-browser click @e3`, shown over the frame. and navigations come from the stream's `url`/`tabs` events. The terminal and files are already visible: shell actions in the transcript and the workspace tree (`listBotWorkspaceTree`). v1 therefore needs no new terminal viewer.

## 4. Take control / return control

**Can input go back over the same channel? Yes, and it's measured.** The relay forwards the viewer's `input_mouse`/`input_keyboard`/`input_touch` to agent-browser's stream, which calls `Input.dispatchMouseEvent`/`dispatchKeyEvent`/`dispatchTouchEvent`. CDP-injected events are `isTrusted=true` ([crawlex](https://blog.crawlex.net/blog/synthesizing-human-input-events/)), so logins and payments behave as if a person did them. Paste works by reading the clipboard on the viewer's side and sending the text as key events. Version 0.27 has no `insertText` passthrough, and the Ctrl+V clipboard lives on the wrong machine anyway. On macOS clients, Cmd shortcuts need CDP `commands`, but 0.27 doesn't forward that field, so the relay maps Cmd→Ctrl ([issue](https://github.com/vercel-labs/agent-browser/issues/1453)).

**Reuse the approval gate.** PR #344, merged to `dev` as `87905548`, already has everything a pause needs:
- `requestToolExecutionApproval` creates a pending `message_action` card.
- `waitForToolApprovalDecision` awaits the settlement in memory (`PENDING_TOOL_APPROVALS_KEY`). It adopts a decision already written to the DB, expires on timeout and stops on abort.
- `onWaitChange(true/false)` marks the run `waiting_approval`. It also pauses the run deadline (`lib/pausable-timeout.ts`) and the stall watchdog, and frees the delegated-run limiter slot.
- Settlement arrives through `/api/message-actions/[actionId]/approve|dismiss`.

**Revalidated on `dev` `aa637084` (2026-09-26):**
- **Restart:** restart handling now lives in `lib/interrupted-work.ts` (#350). Waiting bot runs become **stopped**, or are **requeued** if they are delegated runs; they are not failed. Pending `tool_approval` cards are resolved as stopped, and the resume notice asks the bot to request them again. The new card kinds must be added to both.
- **WebSocket gap:** resolutions are still only emitted to the SSE chat emitter (`broadcastToolApprovalUpdate`). The shared broadcast helper follows `broadcastMessageDraftUpdate` in `lib/message-drafts.ts`.
- **Drafts:** `draft_message` (#354) is a non-blocking pending card that resolves outside the turn, so it stays outside the gate.
- **Stop and redirect:** #353's stop aborts the turn, which fires the gate's abort path. Mid-run redirects apply only at step boundaries, so the "return control" note is the tool result, and messages typed during a handoff stay queued until control returns.

Take control should be **a second kind on the same gate**, not a second mechanism:

1. Pull the generic part of `waitForToolApprovalDecision` (the settle registry, timeout, abort and DB adoption) out into one "user gate", keyed by `message_action` id. `tool_approval`, `computer_handoff` and `secret_request` all use it.
2. **When the bot asks for it:** a new tool `request_takeover({ reason })` creates a `computer_handoff` card ("Sign in to GitHub: 2FA required") and waits on the gate, going through the same `onWaitChange`. The card opens the live view with **Take control**.
3. **When the user starts it:** a **Take control** button in the live view sets `controlOwner = "user"` for that bot. While the user holds control:
   - the shell executor refuses `agent-browser` commands. The label check already exists: `getShellCommandLabel(command) === "Web browser"`. The executor returns "The user has control of the browser; call request_takeover to wait" and never touches the page.
   - The run keeps going for non-browser tools.
4. **Return control** (with an optional note) settles the gate. The tool result sent to the model is "User completed the step and returned control. Note: …", and the run continues. There is no need to "tell the bot to continue" as Grok does, because the run is already paused inside the tool call.
5. Viewer input is accepted **only** from the bot's owner and **only** while `controlOwner === "user"`. Watching is read-only. This prevents stray clicks from disturbing the bot.

**Timeouts (decided): 30 minutes for handoffs and secret requests.** A DM approval expires after 5 minutes, which is too short for someone who has to fetch a 2FA device. The unattended 24 h timeout is too long to keep a browser alive. The bot's browser (or its tab, §7) stays alive while a handoff is pending. The profile is on disk, so an expired handoff costs nothing to resume later.

**Status enum (decided): rename to `waiting_user`.** #344 is merged to `dev`, but `waiting_approval` is in no release yet, so it is renamed on `dev` before the next release (PR A in `agent-computer-plan.md`). Tool approvals, handoffs and secret requests then share one run status. The card's `message_action.kind` says what the wait is for, so the attention label becomes kind-aware instead of adding a `waitReason` field.

The rename touches:
- `lib/types.ts`, `lib/bot-runs.ts`, `lib/bots.ts`, `lib/interrupted-work.ts`, `lib/bot-delegation.ts`
- `components/agents/bot-runs.tsx`, `components/agents/bot-status.tsx`, `hooks/use-delegation-status.ts`
- both contracts and about 13 test files
- the helpers `setBotRunAwaitingApproval`, `setTurnAwaitingApproval` and `onApprovalWait`.

There is no CHECK constraint on the column. Restart reconciliation matches both the old and the new value, so no migration is needed.

## 5. Secure secret request

**Goal:** the value must never enter the model context, logs, transcripts, the `message_actions` payload, the semantic index, argv or the WebSocket chat channel.

**Flow**
1. The bot calls `request_secret({ label: "GitHub password", origin: "https://github.com", target: "@e7" })`. `target` is a snapshot ref, and the tool takes no value argument.
2. This creates a `secret_request` `message_action` whose payload holds only the label, origin and target. The run waits on the same user gate.
3. The web and iOS clients render a masked field (`type=password`, `autocomplete=off`, no echo). They `POST` the value over HTTPS to `/api/message-actions/{id}/secret`, a new route whose body is never logged. It is not sent over `/ws`.
4. The server checks that the bot's **current page origin** equals the requested `origin`. This stops a malicious page from redirecting to phishing between the request and the fill. It then focuses `target` and **types the value by sending `input_keyboard` events over the loopback stream socket**. That means no CLI argv (which any same-uid process can read in `/proc/*/cmdline`), no temporary file and no DB write. I measured that typing through the stream works.
5. The server settles the gate with a tool result of "Secret entered into @e7 on github.com", holding the value only in memory. The card becomes "Provided" and stores no value.
6. **Output redaction:** for the rest of the run, every tool result (shell stdout/stderr, snapshot, `eval`) is scrubbed of exact matches of the value and its base64 and URL-encoded forms before it reaches the model or `message_actions`. After that the value is dropped.

**Where it can leak unless redacted first (corrected on revalidation):** the semantic index ingests message content, user memories, memory nodes and attachment text (`lib/semantic-index.ts:97-118`). It does not index `message_actions` directly, but tool output still reaches both the model and the index through two paths:
- completed shell `resultSummary` values are replayed into later prompts (`lib/compaction.ts`);
- compaction summarises them into `memory_nodes`, which are indexed (`lib/compaction-turns.ts`).

Redaction must therefore run **before** the result is saved (`onActionComplete`/`onActionError`), not only before the model sees it. Frames are not persisted. Password fields render masked in the snapshot: I measured `textbox [ref=e2]: •••••••`.

**Honest limit (measured):** once the value is in the page, the bot can read it back. `agent-browser eval 'document.getElementById("p").value'` returned `"S3cr3t!"`. The redaction layer stops accidental echo, but a prompt-injected bot that deliberately re-encodes the value (reverses it, `charCodeAt`, sends it to a URL) can still get it out. Grok's wording has the same boundary: the value is "not shown to the model"; the model is still not blocked from reading it. Mitigations, in order of cost:
1. Redaction, as above.
2. Hold the gate until the form is submitted, and deny `eval` for the rest of that step. The action policy for that only exists in agent-browser 0.38 or later, and any shell command could get around it.
3. The egress proxy from §6, which limits where the value could be sent.

**Storing credentials (decided: ships with the secrets PR).** "Save for next time" encrypts the value with the existing `lib/crypto.ts` `encryptValue` into a `user_credentials` table scoped to (user, origin), since the browser is per user. `use_credential({ origin, target })` fills it through the same server-side path with no prompt, same origin only. The API field is `savedLogins`, because the mobile sanitiser strips `credentials`. The secrets PR lands **after** Landlock hardening: without it, a bot shell could read `eidon.db` and the server's `/proc/1/environ`, which holds the encryption secret. Do **not** use agent-browser's `auth save` vault: it lives in `$HOME/.agent-browser/auth` next to its auto-generated key (`~/.agent-browser/.encryption-key`), which the bot shell can read.

## 6. Isolation inside the one app container

Probed in a default Docker container: default seccomp and AppArmor, no extra capabilities, non-root.

| Mechanism | Works under default Docker? (measured) | Added size | What it protects against |
|---|---|---|---|
| bubblewrap | **No.** "bwrap: No permissions to create new namespace", even as root | 1 package, under 1 MB | n/a without `seccomp=unconfined` plus `apparmor=unconfined` ([bubblewrap#505](https://github.com/containers/bubblewrap/issues/505), [moby#42441](https://github.com/moby/moby/issues/42441)) |
| `unshare -U` / nsjail | **No.** "unshare failed: Operation not permitted". nsjail is not in bookworm | n/a | Same blocker (seccomp blocks `CLONE_NEWUSER`) ([nsjail](https://nsjail.dev/)) |
| Chromium's own sandbox | **No.** "No usable sandbox!". agent-browser adds `--no-sandbox` by itself | `chromium-sandbox`, about 0.4 MB, which doesn't help | Renderer escapes. Needs a per-container seccomp profile ([jessfraz chrome.json](https://github.com/jessfraz/dotfiles/blob/main/etc/docker/seccomp/chrome.json)) or SYS_ADMIN |
| **Landlock** | **Yes**, unprivileged. ABI 4 on kernel 6.8. A filesystem read-deny and a TCP-connect deny were both enforced | **+0 packages.** A launcher of about 40 lines using the `python3` + `ctypes` we already ship (the syscalls are 444/445/446) | Filesystem allow-list (the DB, `.env`, other bots' and users' dirs); TCP connect by port (ABI 4 and later, kernel 6.7 and later); ptrace and `/proc/<pid>` access to processes outside the domain ([kernel docs](https://docs.kernel.org/userspace-api/landlock.html), [ABI table](https://man7.org/linux/man-pages/man7/Landlock.7.html), [moby#43199](https://github.com/moby/moby/pull/43199) allows the syscalls) |
| `setpriv --no-new-privs`, `prlimit`, `timeout` | **Yes** (util-linux and coreutils are Essential; `setpriv` with a uid switch worked as root) | +0 MB | setuid escalation, fork bombs, runaway commands. **A per-browser memory cap is not possible:** Chromium reserves a huge virtual address space (1.4 TB VIRT observed), so `RLIMIT_AS` breaks it, and cgroups need privileges |
| Separate uid `eidon-bot` for bot shell and browser | Only if the container **starts as root** and the entrypoint drops privileges: Node runs as `eidon`, and a tiny root launcher runs bot commands as `eidon-bot` | +0 MB (`setpriv`) | Unix permissions around the data volume, including on hosts without Landlock. It costs a Dockerfile `USER` change and a migration of volume ownership |
| Egress limits | iptables/nftables are **not possible** without `NET_ADMIN` (`iptables` would add 8 MB for nothing). `HTTP(S)_PROXY` is advisory only | +0 MB: a small filtering proxy inside the Node server | Chromium gets `--proxy-server=127.0.0.1:<p>` through `AGENT_BROWSER_PROXY`. The proxy rejects loopback (including `:3000`), RFC 1918, link-local and metadata (169.254.169.254), CGNAT and IPv6 ULA, and re-checks after DNS resolution and after every redirect. Combined with Landlock "connect only to port `<p>`" for the bot shell, a shell command can no longer bypass it over TCP. **UDP/DNS still escapes** until Landlock ABI 10 (kernel 7.2) |

### What each layer realistically buys

Landlock plus the in-process proxy:
- Stops a prompt-injected bot from reading `eidon.db`, `.env` or other users' workspaces and profiles.
- Stops it from reaching Eidon's own API on `localhost:3000` or the LAN.
- **Stops cross-bot browser hijacking over loopback**, which is possible today (next section).

Two launcher profiles are needed:
- **"shell"**: filesystem rules plus the TCP-connect allow-list with only the proxy port.
  - Read-write: the bot's own workspace, the team folder `bot-workspaces/<owner>/shared` (#351), `$TMPDIR`, `/tmp`, the bot's own socket dir, and a per-bot `HOME` (`<botWorkspace>/.home`). The shared `/app/data/home` holds `.agent-browser/` state for every user.
  - No access to `agent-computer/`, `eidon.db`, `.env`, other bots' private workspaces or other socket dirs.
  - The launcher execs in place, so the shell's process-group kill (10-minute ceiling) keeps working.
- **"browser"**: filesystem rules only, applied when the server starts the daemon. agent-browser has to reach Chromium over TCP CDP on a random loopback port, so the network rule can't apply here.

On kernels without Landlock (older Docker Desktop LinuxKit 5.15, some NAS kernels), the launcher detects that and reports "isolation: unavailable" in Settings instead of failing silently ([Docker Desktop kernel notes](https://github.com/docker/for-mac/issues/7877)).

### What cannot be done without an extra container

- Kernel-enforced IP-level egress filtering and UDP/DNS blocking.
- Chromium's renderer sandbox.
- A per-browser memory cgroup.
- Real process-namespace separation.

### Is an optional sidecar worth it?

Not now. It would be a `profiles: ["computer"]` compose service (headless-shell with a `chrome.json` seccomp profile, CDP on an `internal: true` network, and an egress-proxy container). For a single-household self-host, the threats that matter are a prompt-injected bot reading the database or pivoting through the browser, and Landlock plus the proxy covers both for 0 MB. The sidecar doubles the deployment surface: compose-only, a second image, CDP over the network, and no Unraid/Portainer single-container story. Revisit it if Eidon is used multi-tenant, or if users ask for hard egress control. agent-browser already supports `--cdp ws://…` ([CDP mode](https://github.com/vercel-labs/agent-browser/blob/main/docs/src/app/cdp-mode/page.mdx)), so the door stays open at zero cost.

## 7. Persistence and sharing

### What happens today (measured with 0.27.0)

- On `close`, agent-browser writes cookies and localStorage to `$HOME/.agent-browser/sessions/<SESSION_NAME>-<SESSION>.json` ([`state.rs`](https://github.com/vercel-labs/agent-browser/blob/v0.27.0/cli/src/native/state.rs)).
- Every bot uses `bot`/`bot`, and `HOME=/app/data/home` is shared. So **every bot of every user writes to the same plaintext file, `/app/data/home/.agent-browser/sessions/bot-bot.json` (mode 644)**, and any bot's shell can `cat` it.
- Auto-restore did not bring the state back, neither for the same bot nor for another one. **Logins therefore don't survive `close`**, and the builtin skill tells the bot to close after every task.

### Either way: use a real Chromium profile directory

Pass `--profile <dir>`. A real profile persists cookies, localStorage, IndexedDB and service workers exactly as a normal browser does, with no state files. Drop `AGENT_BROWSER_SESSION_NAME`. Keep the directory under `EIDON_DATA_DIR/agent-computer/…` with mode 700, outside `bot-workspaces/`, so it doesn't appear in the workspace tree. With Landlock, the "shell" profile gets no access to it. Add `--disk-cache-size` to keep it small.

### Can all bots share one profile to save RAM? Yes: one browser per user, one tab per bot

**How it works.** Chromium locks a profile directory: a second Chromium on the same directory aborts with "Failed to create a ProcessSingleton for your profile directory… Aborting now to avoid profile corruption" (measured). Sharing a profile therefore means **one Chromium process shared by the bots, with a tab for each bot**:
- The server launches that Chromium itself, headless, with `--user-data-dir=<profile>` and `--remote-debugging-port=0`, and reads the port from `DevToolsActivePort`.
- Each bot's agent-browser session attaches with `--cdp <port> --pin-tab` (agent-browser 0.38, [CDP mode docs](https://github.com/vercel-labs/agent-browser/blob/v0.38.1/docs/src/app/cdp-mode/page.mdx)).
- Each session still has its own daemon (about 10 MB), its own stream server and its own tab.

**Scope: per user, never across users.** A single profile for *all* bots on the server would hand one user's logins to another user's bots. "One shared profile" therefore means one per user (`agent-computer/<user>/profile`), which is exactly Grok's model: "Every Bot on your account uses the same computer… Each Bot gets its own screen… The screens are separate work surfaces, not separate security boundaries." With several active users there is one Chromium per active user.

**Memory measured** (agent-browser 0.38.1 on Node 24, Chromium 153, arm64, four bots each on GitHub):

| Setup | PSS | Chromium processes |
|---|---|---|
| One Chromium per bot (4 profiles) | 1,430 MB | 44 |
| One shared Chromium, one tab per bot | **821 MB (−43 %)** | 13 |

A single browser with one tab is about 430–490 MB, so each additional bot tab costs roughly 110 MB instead of about 450 MB for another browser.

**What happens when several bots use the browser at the same time** (measured):
- **Navigation and actions:**
  - With `--pin-tab` on each session's first command, **20 out of 20** concurrent navigations (4 bots × 5 rounds) landed in the right tab. Concurrent `snapshot` calls also returned each bot's own page.
  - Without pinning, **9 out of 12** landed in another bot's tab. Unpinned sessions adopt whatever tab is currently active, and the docs keep that behaviour on purpose for compatibility.
  - So the server must set `AGENT_BROWSER_PIN_TAB=1` in the bot's environment and create the binding itself. A bot must never be able to start an unpinned session.
- **Rendering and live view:** in headless every tab reports `visibilityState: "visible"`, so background tabs are not throttled. Two bots streaming at once each got 51 frames in 5 s from their own stream servers. The live view and take control keep working per bot, and taking control of one bot's tab doesn't touch the others.
- **Cookies and site storage are shared:**
  - When bot 1 set `account=ALICE` and bot 2 then set `account=BOB` on the same site, bot 1 read `account=BOB`.
  - So two bots can't be signed in to **different accounts on the same site** at once, and signing out in one bot signs out all of them.
  - Downloads, permissions and saved site data are shared the same way.
- **Shared fate:** if the shared Chromium crashes or is OOM-killed, every bot of that user loses its browser. The next command fails ("All CDP discovery methods failed"). The server has to supervise the process, restart it (about 0.4 s) and rebind tabs. Logins survive because they are in the profile, but open pages and form state are lost.
- **Bots can reach each other's tabs:**
  - Any bot shell can list, drive or close another bot's tab through the loopback CDP port. I closed bot 2's tab from outside, and bot 2's next command failed with `tab_gone`.
  - It can also simply name another session: `agent-browser --session <other> …`.
  - With a per-user profile, that is the same user's other bots. That matches Grok's "not separate security boundaries", but a prompt-injected research bot can then use the banking login another bot signed in with.
  - Landlock's "shell" profile (TCP connect only to the proxy port, own socket dir only) closes the raw-CDP route. The shared login jar itself is inherent to sharing.
- **Concurrency limit:** tabs share one browser process, so the global cap in §8 counts **browsers** (one per active user), plus a per-browser tab budget.

**Recommendation.** Use a shared per-user browser as the default, since RAM is the main constraint on small boxes and it matches the reference product, and the Node 24 decision unlocks `--pin-tab`. If a bot needs its own logins, it could opt out into an isolated profile at the cost of a full browser (open question). Other consequences:
- `reset-browser-session` becomes "sign out everywhere" for **all** of the user's bots. A per-bot reset only closes that bot's tab.
- Deleting a bot closes its tab and keeps the user's profile, as Grok does.

## 8. Resource limits

| Measured (arm64, Chromium 153 headless, PSS summed over all Chromium processes) | MB |
|---|---|
| 1 session, blank page | 430 |
| 1 session, Wikipedia | 489 |
| 4 sessions (Wikipedia + 3× GitHub) | 1,406–1,445 (44 processes) |
| 4 sessions with `--renderer-process-limit=2 --disable-features=IsolateOrigins,site-per-process --js-flags=--max-old-space-size=256` | 1,249 (32 processes), about −14 % |
| agent-browser daemon per session | about 10–13 RSS |
| Idle Eidon server, with embedding model (emulated amd64, approximate) | about 1,040 |

Published reports agree with these: 300–500 MB per rendering instance ([crawlex](https://blog.crawlex.net/blog/headless-browser-tax/)), 100–300 MB baseline plus 50–150 MB per page ([webscraping.ai](https://webscraping.ai/faq/headless-chromium/how-can-i-make-headless-chromium-use-less-cpu-and-memory)). Cold start measured 400 ms. agent-browser passes `--disable-dev-shm-usage` itself, so Docker's 64 MB `/dev/shm` is not a problem.

**Capacity on a typical self-host box:**

| Box | One browser per bot | Shared browser per user (§7) |
|---|---|---|
| **2 GB** (Eidon about 1 GB) | **One** bot browsing at a time. A second browser pushes the box into swap or the OOM killer | One user's browser with about three bot tabs |
| **4 GB** | About three browsers, or four with the memory flags (which weaken site isolation, so only for low-trust browsing) | Two or three active users, each with several bot tabs |

**The existing limiter doesn't protect memory.** `DEFAULT_MAX_CONCURRENT_BOT_RUNS_PER_USER = 4` is per user. Every run can start its own Chromium, and each one stays alive for agent-browser's **1 h default idle timeout**. Two users running four bots each could try to hold eight Chromiums.

**Recommendation:**
1. A **global memory budget**, separate from the run limiter. Charge about 0.5 GB for the first tab of a browser and about 0.12 GB for each further tab, against `os.totalmem() − 1.2 GB`, with an env override. A run that needs a browser while at the cap waits for a slot, reusing the `acquireBotUserSlot` waiter pattern with a global key. If the wait is long, the bot is told "browser busy" instead of letting the kernel OOM-kill it.
2. **Idle stop after 10 minutes** (`AGENT_BROWSER_IDLE_TIMEOUT_MS=600000`, owned by the server). Because the profile persists, restarting costs about 0.4 s and loses nothing. A pending handoff or an open live view keeps its browser alive, and the least recently used idle browser is closed first.
3. Change the builtin skill: drop "Always close the browser when done", since idle stop handles it. Add: "use `request_takeover` for passwords, 2FA, CAPTCHAs and payments; use `request_secret` for secrets; never ask for a password in chat".

## 9. Security risks

1. **Cross-bot and cross-user browser control, today.**
   - Every agent-browser daemon exposes the stream WebSocket, which sends no `Origin` from a CLI client and accepts input, plus Chromium's CDP port, all on loopback. Every bot shell runs as the same uid.
   - Any bot can scan `127.0.0.1` and drive another user's logged-in browser, or simply run `AGENT_BROWSER_SOCKET_DIR=…/bots/<other> agent-browser eval …`.
   - The live view doesn't create this risk, but relaying input makes the browser more valuable to hijack.
   - **Fix:** Landlock "shell" profile: TCP connect only to the proxy port, and socket dirs outside the allowed filesystem.
2. **Shared plaintext cookie file**, today (§7). Fix it now: unique session names or `--profile` per bot, then delete `bot-bot.json`.
3. **The bot can read a typed secret back from the DOM** (measured, §5). Redaction and origin pinning reduce the risk but don't remove it. The UI copy should say "Eidon won't send this to the model", not promise more.
4. **Input injection through the relay.** Accept input only from the owning user who holds control, clamp coordinates to the viewport, rate-limit, and drop input while the bot holds control.
5. **The live view shows sensitive content.** Never persist frames. Mobile should blank the view when the app goes to the background. Later, "teach a task" must pause recording while a secret is being filled.
6. **Browser SSRF** into `localhost:3000`, the LAN or cloud metadata, via navigation, fetch or WebRTC. Mitigation: the proxy plus `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.
7. **Chromium runs with `--no-sandbox`.** A renderer exploit runs as `eidon` with the whole data volume. Mitigation: the Landlock "browser" profile; then a separate uid; then the sidecar for a real sandbox.
8. **Unpinned supply chain.** `npm install -g agent-browser` floats to whatever version matches the engine check, and ships unused binaries. Pin the exact version and delete the non-Linux binaries.
9. **Memory denial of service** (§8). The global cap and idle stop address it.

## 10. Component and file map

| Area | Change |
|---|---|
| `Dockerfile`, `package.json`, `.github/workflows/test.yml` | **Node 24 (decided):** base `node:24-bookworm-slim`, CI `node-version: 24`, `@types/node` 24. Bump `better-sqlite3` from 11.10.0 to **12.x**: 11.10.0 has no Node 24 prebuild, and on the slim image it falls back to a source build that fails. That was measured on both arm64 and amd64, and 12.11.1 installs on both. 12.0.0's only breaking change is dropping Node 18. `sharp` 0.34.5 and `onnxruntime-node` 1.24.3 load on Node 24 unchanged (measured). Pin `agent-browser@0.38.1` exactly. Delete `bin/agent-browser-{darwin,win32,linux-musl}*` and the other-arch Linux binary (−60 MB). Later, copy `scripts/landlock-exec.py`. **No new apt packages.** |
| `lib/agent-computer.ts` (new) | Lifecycle of the shared per-user Chromium (launch with `--user-data-dir`, read `DevToolsActivePort`, supervise and restart, rebind tabs on `tab_gone`) and of per-bot pinned sessions (stream-port discovery, idle stop). Global memory budget, relay hub (viewers, latest-frame fan-out, fps cap, backpressure), `controlOwner`, key-event normalisation (always set `code`), secret typing. |
| `lib/bot-sandbox.ts` | Per-user profile dir `agent-computer/<user>/profile`. Drop `AGENT_BROWSER_SESSION_NAME`. Give each bot `AGENT_BROWSER_CDP=<port>`, `AGENT_BROWSER_PIN_TAB=1` and a unique `AGENT_BROWSER_SESSION=<botId>`. Add idle timeout and proxy. On bot delete, close the bot's tab. |
| `lib/local-shell.ts` | Allow `AGENT_BROWSER_CDP`, `AGENT_BROWSER_PIN_TAB`, `AGENT_BROWSER_PROXY`, `AGENT_BROWSER_IDLE_TIMEOUT_MS`. Later, wrap the spawn in the Landlock "shell" launcher when available. |
| `lib/tool-approvals.ts` (on `dev` since #344) | Extract the generic user gate (settle registry, timeout, abort, DB adoption) that `tool_approval`, `computer_handoff` and `secret_request` share. Drafts stay separate. Add a shared `loadPendingAction(kind)` and a WS `broadcastActionUpdate`. |
| `lib/interrupted-work.ts`, `lib/bots.ts`, `components/agents/bot-status.tsx` | Restart resolves the new card kinds as stopped and the resume notice re-asks. `getBotStatus` counts the three gate kinds. The attention label is kind-aware. |
| `lib/tool-definitions.ts`, `lib/tool-executors.ts` | New `request_takeover` and `request_secret` tools (later `use_credential`). Refuse `agent-browser` commands while the user holds control. Redact secrets from tool output. |
| `lib/types.ts`, `lib/db-migrations.ts` | `MessageActionKind` gains `computer_handoff` and `secret_request`. Later, a `bot_credentials` table (values encrypted with `lib/crypto.ts`). |
| `lib/ws-upgrade-router.ts`, `server.cjs`, `lib/agent-computer-relay.ts` (new) | A second `WebSocketServer` for the exact paths `/ws/computer` and `/api/v1/ws/computer` (`?conversationId=`). The same auth, via exported `extractToken`/`extractBearerToken`. An Origin check. A small schema for the binary-frame and JSON control messages. `resolveWebSocketAuthMode` learns the new mobile path. Production SIGTERM handling. |
| `app/api/conversations/[conversationId]/computer/route.ts` (new) | `GET` state (live, url, caption, viewport, controlOwner). |
| `app/api/conversations/[conversationId]/computer/control/route.ts` (new) | `POST {action: "take" \| "return", note?}`. |
| `app/api/message-actions/[actionId]/secret/route.ts` (new) | `POST {value}`. Never logged, and never echoed back. |
| `app/api/v1/[...path]/route.ts` | Mount the three new routes. |
| `lib/db-builtin-skills.ts` | Skill text changes (§8, item 3). |
| `lib/bot-run-limiter.ts` | Add a global memory-budget waiter next to the per-user run slots. |
| UI: `components/computer-session-card.tsx` (new), `hooks/use-computer-stream.ts` (new, owns its own socket) | The live view as a card in the conversation thread (the direction chosen at the design gate): frame, status caption, Take/Return control and keyboard capture in a full-screen stage. |
| UI: `components/computer-handoff-card.tsx`, `components/secret-request-card.tsx` (new) | Rendered in `components/message-bubble.tsx` on the `draft_message` card template, next to the tool-approval branch. |
| Contracts | `contracts/mobile-api-v1.openapi.json`: the four operations above, new action kinds, and the status enum `waiting_user` (renamed from `waiting_approval` on `dev` before the next release). `contracts/mobile-api-v1.websocket.schema.json` (or a new `…computer-websocket.schema.json`): frame, status, url, tabs, control and input messages. Update counts in `tests/unit/mobile-contracts.test.ts` and `tests/unit/mobile-routes.test.ts`. **The PR must say that native clients have to regenerate their derived specs.** |
| iOS | Out of this plan. A separate agent's PR uses the `sync-parity` skill. The client draws JPEG frames, maps touches to `input_mouse` (tap) and `input_touch` (scroll), sends keys through a hidden text field, and shows the masked secret sheet, all through the documented API. |

UI work follows the design-direction gate when it is built. Nothing here chooses a visual direction.

## 11. Phased rollout

The locked PR order and scope are in `docs/plans/agent-computer-plan.md`:

- **PR A:** `waiting_user` rename and WS broadcast of resolved cards.
- **PR 0:** Node 24 and agent-browser 0.38.1.
- **PR 1:** browser host (shared per-user browser, persistence, memory budget; also fixes the cross-user browser in non-bot chats).
- **PR 2:** live view.
- **PR 3:** take control and return control.
- **PR 4:** Landlock and the egress proxy.
- **PR 5:** secure secret request and saved credentials.

Hardening comes before secrets on purpose. iOS is handled separately. Later: teach a task (no `ffmpeg`, which is +141 MB and 89 packages, measured), an optional isolated per-bot profile, and an optional sidecar.

## 12. Decisions and open questions

**Decided (2026-09-25 and 2026-09-26). All former open questions are closed:**
- **Node 24 base image.** Unlocks agent-browser 0.38: `--pin-tab`, stream `maxFps`/quality, `--allowed-domains`, `--action-policy`, `--confirm-actions`, `--content-boundaries`. Needs `better-sqlite3` 12.
- **`waiting_user`** replaces `waiting_approval`, on `dev` before the next release.
- **Timeout:** 30 minutes for handoffs and secret requests; the bot's tab stays alive meanwhile.
- **Browser profile:** one shared browser per user, one pinned tab per bot.
- **Saved credentials:** ship with the secrets PR; same-origin reuse needs no prompt.
- **Isolation:** Landlock plus the in-process egress proxy. Warn, not refuse, without Landlock. No uid split, no sidecar.
- **Availability:** on for every bot, with a memory budget.
- **Scope:** a browser-only view.
- **iOS:** handled separately via `sync-parity`.

## Method and cleanup

- **Commands run:**
  - `docker history` on the published image.
  - A native rebuild of the browser layer.
  - `apt-get install -s` / `apt-cache show` deltas in a throwaway bookworm container.
  - Scratch Node scripts against agent-browser's stream: fps, frame size, input round trip, secret readback.
  - PSS sums from `/proc/<pid>/smaps_rollup`.
  - bwrap, unshare, Chromium-sandbox and Landlock probes.
  - Two cookie-file reproduction runs.
  - Shared-browser runs on Node 24 with agent-browser 0.38.1: memory, profile lock, pinned and unpinned concurrency, cookie sharing, per-tab streams, cross-tab close, crash.
  - Native-module installs on `node:24-bookworm-slim` (arm64 and amd64).
- **Sources:** agent-browser npm, source and docs; the CDP protocol definitions and Chromium source; Debian package pages; the kernel Landlock docs.
- All scratch containers, images, build intermediates and scripts were deleted.
- The Colima VM was restarted because its Docker socket was dead.

# Voice-to-Text Composer Input Design

## Summary

Add voice-to-text input to the chat composer so users can dictate into the draft textarea using a compact microphone control. Recording should stay local-first where possible, show live audio activity while listening, require an explicit stop action to finalize transcription, and append the resulting text into the existing draft without auto-sending.

This design uses a hybrid speech architecture. The default path uses browser-native speech recognition when available, while a user-facing setting allows switching to an embedded on-device model path. The UI and session flow are engine-agnostic so the embedded path can mature without reworking the composer experience.

## Goals

- Add a microphone affordance to the existing chat composer.
- Support explicit recording start and stop controls.
- Show a live audio activity bar while the microphone is listening.
- Transcribe only after stop, then append the transcript to the draft textarea.
- Never send automatically after transcription completes.
- Support manual language selection for English, French, and Spanish.
- Persist a user-facing speech engine preference with `Browser` as the default and `Embedded model` as an advanced option.
- Keep the implementation local-first where supported by the platform and selected engine.

## Non-Goals

- Automatic send after dictation.
- Automatic language detection.
- Server-side speech-to-text fallback for unsupported browsers.
- Speaker diarization, punctuation editing tools, or post-transcription rewrite assistance.
- Reworking unrelated composer controls or broader settings IA beyond the additions needed for speech input.

## Current State

- The composer lives in [`components/chat-composer.tsx`](/Users/charles/.codex/worktrees/1e12/Eidon-AI/components/chat-composer.tsx) and already owns the main draft textarea plus send/stop, attachments, provider, and persona controls.
- The app has a settings surface with per-section cards and routes under [`app/settings`](/Users/charles/.codex/worktrees/1e12/Eidon-AI/app/settings).
- There is no existing speech recognition, microphone capture, or audio visualization code in the repo.
- The composer currently has one primary action cluster, so speech input needs to fit within an already dense but cohesive control area.

## Approach Options Considered

### 1. Browser-native speech recognition only

Use `SpeechRecognition` / `webkitSpeechRecognition` directly in the composer and rely entirely on the platform speech engine.

Pros:
- Smallest implementation.
- Fast startup and low bundle impact.
- Good fit for a first pass on Chrome-family browsers.

Cons:
- Inconsistent support across Safari, Firefox, and mobile browsers.
- Weak control over quality and capability differences.
- No path for honoring an explicit embedded-model user preference.

### 2. Embedded on-device model only

Ship an in-browser on-device speech model and use it for all transcription.

Pros:
- Strongest local-processing story.
- Consistent internal API and language control.
- Better long-term control over model behavior.

Cons:
- Largest implementation and runtime cost.
- Heavier startup, memory, and battery footprint.
- Higher risk on mobile and lower-powered devices.

### 3. Hybrid speech adapter

Build a speech input controller with interchangeable engines. Default to browser-native recognition, but expose a user setting that allows selecting an embedded on-device model path when available.

Pros:
- Best balance of shipping speed and future quality.
- Supports the requested user-facing engine preference.
- Keeps the UI stable even as the embedded path evolves.

Cons:
- Requires clearer capability checks and unsupported-state handling.
- Slightly more up-front architecture than a browser-only integration.

## Chosen Design

Use option 3.

The app should introduce a speech input subsystem with two engine modes:

- `browser` — default
- `embedded` — user-selectable when supported

The composer should not contain engine-specific logic beyond rendering state. It should delegate to a client-side controller that handles microphone permission, audio level monitoring, session state, transcription finalization, and engine selection based on user settings.

## User Experience

### Composer Controls

Add a microphone affordance near the existing composer action controls in [`components/chat-composer.tsx`](/Users/charles/.codex/worktrees/1e12/Eidon-AI/components/chat-composer.tsx).

States:

| State | UI |
|-------|----|
| idle | Mic icon is visible and clickable |
| requesting permission | Mic control shows a pending state and disables duplicate starts |
| listening | Live audio activity bar is visible and a stop control appears |
| stopping/transcribing | Controls remain visible but disabled while final transcript is produced |
| completed | Transcript is appended into the draft and controls return to idle |
| unsupported/error | Mic control is disabled or shows inline error feedback |

Behavior:
- Starting recording does not clear the existing draft.
- While listening, the user sees a horizontal activity indicator that reflects microphone input level.
- A stop button appears during the active listening session.
- Pressing stop finalizes transcription and appends the transcript to the existing draft.
- The send button remains manual and separate from dictation completion.

### Draft Insertion

When transcription completes successfully, the resulting text is appended to whatever is already in the textarea.

Rules:
- If the draft is empty, the transcript becomes the draft.
- If the draft already contains text, append the transcript with appropriate spacing rather than overwriting.
- If transcription returns an empty result, do not change the draft.

### Language Selection

Provide an explicit language picker for:

- English
- French
- Spanish

English is the default language.

The language picker should be accessible from the composer while also persisting a default in settings. The active recording session always uses the explicit selected language rather than attempting auto-detection.

### Settings

Add a speech-to-text section to the existing settings UI.

Fields:
- `Speech-to-text engine`
  - `Browser` (default)
  - `Embedded model`
- `Default language`
  - `English`
  - `French`
  - `Spanish`

The settings should persist user preference so the composer loads the last chosen engine and default language on subsequent sessions.

## Architecture

### Speech Input Controller

Introduce a dedicated client-side controller responsible for the speech session lifecycle:

`idle -> requesting-permission -> listening -> stopping -> transcribing -> completed | failed`

Responsibilities:
- start and stop recording sessions
- request microphone access
- manage selected engine and language
- expose live session state to the composer
- return a finalized transcript only after stop

The controller should be reusable and testable independently of the composer layout.

### Speech Engine Interface

Define a narrow engine contract that the controller can call without knowing the underlying implementation details.

Responsibilities of an engine:
- report whether it is supported in the current browser/runtime
- start a recognition session for a given language
- stop the active session
- return or resolve the final transcript
- surface recoverable and terminal errors in a normalized way

Planned implementations:
- `BrowserSpeechEngine`
- `EmbeddedSpeechEngine`

The embedded engine can ship behind a capability gate, but the interface must be real from the start so the user-facing setting is backed by an explicit capability check rather than a silent fallback. If embedded execution is not available in the current build or runtime, the setting remains visible and the app surfaces that unavailability directly when selected.

### Audio Level Monitor

Keep live audio visualization separate from transcription.

Use microphone capture plus an analyser pipeline to produce a simple normalized input level stream that drives the activity bar. This monitor should work regardless of which engine is selected, assuming the chosen engine requires microphone access in the browser.

This separation prevents the waveform UI from being coupled to browser-specific speech recognition events.

## Engine Behavior

### Browser Engine

The browser engine uses `SpeechRecognition` / `webkitSpeechRecognition` when available.

Requirements:
- explicit language mapping from app language option to browser locale code
- no automatic send
- collect final result only when stop completes
- handle unsupported browsers clearly

Suggested locale defaults:
- English -> `en-US`
- French -> `fr-FR`
- Spanish -> `es-ES`

These mappings should be centralized so they can be refined later without touching UI components.

### Embedded Engine

The embedded engine represents a local on-device model path selected by the user through settings.

Requirements:
- capability check before recording starts
- explicit unsupported message when the current browser/device cannot run the embedded model
- no silent fallback to browser mode when the user explicitly selected embedded mode

This design leaves room for the initial embedded implementation to be minimal or staged, but the user contract is fixed now: engine choice is explicit, and unsupported embedded execution must be surfaced honestly.

## Compatibility Model

This feature targets desktop and mobile browsers, but not all browsers will support all engines equally.

Capability checks should be separated into:
- microphone access available
- browser speech engine available
- embedded runtime/model available

Examples:
- If the user selected `Browser` and the browser lacks a native recognition API, the app should state that browser speech recognition is unavailable.
- If the user selected `Embedded model` and the embedded runtime is unavailable, the app should state that the embedded engine is unavailable on this device/browser.
- If microphone permission is denied, the app should show a permission-specific error regardless of engine.

The app should not silently route around an explicit user engine preference.

## Error Handling

### Permission Errors

If the user denies microphone permission:
- stop the session immediately
- return to a non-listening UI state
- show an inline message near the composer explaining that microphone access is required

### Unsupported Engine

If the selected engine is unsupported:
- disable or block session start
- explain why the selected engine cannot run in the current environment
- keep the user’s saved preference intact until they explicitly change it

### Empty Transcript

If stop completes but no transcript text is produced:
- do not modify the draft
- show a small non-destructive notice

### Runtime Failures

If recognition fails mid-session:
- stop listening
- clear the live meter
- preserve the existing draft unchanged
- show a concise inline error rather than a global failure banner

## File Boundaries

Likely changes are:

| File | Change |
|------|--------|
| `components/chat-composer.tsx` | Add mic control, language picker, live recording bar, and speech state rendering |
| `components/settings/sections/general-section.tsx` | Add STT engine and default language controls |
| `app/api/settings/**` or existing settings persistence path | Persist engine and default language preferences if not already represented in client state |
| `lib/types.ts` | Add speech settings and session state types |
| `lib/` speech module(s) | Add controller, engine interface, browser engine, embedded engine scaffolding, and audio level monitor |

The speech-to-text controls should live in the existing general settings section so users can find microphone behavior alongside other user-level application defaults. The speech subsystem itself should stay out of feature-specific UI files except for the composer and settings presentation layers.

## Testing

### Automated Coverage

- speech session state transitions
- transcript append behavior with empty and non-empty drafts
- engine preference persistence
- language preference persistence
- unsupported-engine handling
- empty-transcript handling
- permission-denied handling where testable with mocks

### Manual Validation

Validate in the browser for the following environments:
- Chrome desktop
- Safari desktop
- one Android mobile browser
- one iPhone mobile browser

Validate the following flows:
- start recording and see live audio activity
- stop recording and append transcript without auto-send
- confirm send remains manual
- switch languages between English, French, and Spanish
- switch engine setting between Browser and Embedded model
- verify explicit unsupported states when an engine is unavailable

Per project instructions, final implementation validation should use browser testing and screenshots.

## Risks

- browser-native speech support remains inconsistent across browsers, especially outside Chromium
- the embedded path may be selectable before it is equally mature across all devices
- mobile permission flows may add UI edge cases not seen on desktop
- packing too much state directly into the composer could make the component harder to maintain if the speech subsystem is not properly isolated

The chosen design reduces this risk by isolating engine logic and keeping the composer mostly declarative.

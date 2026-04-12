# Branching / Fork Conversation Design

**Date:** 2026-04-11
**Status:** Draft

## Summary

Add a fork action to assistant messages so a user can branch a conversation from any completed assistant turn into a new conversation with inherited context. The fork should behave as a historical cutoff: the new conversation contains the exact persisted state of the original thread from the beginning through the selected assistant message, and excludes everything after it.

The fork action appears as a small double-arrow icon in the assistant message action row, directly next to the existing copy icon. Clicking it immediately creates the branched conversation and navigates the user into the new `/chat/<conversationId>` route.

## Goals

- Let users explore an alternative path without losing the original thread
- Make branching available directly from assistant messages where users naturally decide to diverge
- Preserve full persisted conversation detail in the fork, including thinking, actions, attachments, and eligible compaction state
- Keep the client implementation thin by making the server the source of truth for cloning behavior

## Non-Goals

- Adding fork support to user messages
- Keeping the user in the original thread after the fork is created
- Creating a lightweight summary-only branch format
- Introducing shared references between the original conversation and the fork
- Redesigning the message action row beyond adding the new affordance

## Product Decisions

### Branch point semantics

- Forking is only available on assistant messages
- The selected assistant message is inclusive
- The forked conversation contains every message from the start of the source conversation through the selected assistant message
- Any message after the selected assistant message is excluded from the fork

This is a true branch-from-here model, not a full clone with a labeled anchor.

### Navigation behavior

- After a successful fork, the app navigates immediately to the new conversation
- The user should land on the normal chat route for that conversation
- The original conversation remains unchanged and available in the sidebar

### Fidelity

- The fork preserves all persisted message detail, not only visible text
- Thinking content, tool/action rows, streamed text segments, attachments, and eligible compaction artifacts are copied into the new conversation

## Recommended Approach

Implement the feature as a dedicated server-side fork endpoint scoped to the selected message, such as:

- `POST /api/messages/[messageId]/fork`

This endpoint should:

1. Authenticate the user
2. Load the selected message and verify it belongs to the user via its parent conversation
3. Reject requests where the message role is not `assistant`
4. Create a new conversation that inherits the original conversation's folder and provider profile
5. Clone the source conversation prefix through the selected message inside a single database transaction
6. Return the new conversation so the client can navigate immediately

This keeps the cloning contract centralized and reusable, avoids leaking copy logic into the client, and makes it easier to preserve fidelity across related tables.

## UX Design

### Assistant message affordance

The assistant action row in [components/message-bubble.tsx](/Users/charles/.codex/worktrees/4dc4/Eidon-AI/components/message-bubble.tsx) currently exposes a copy button. Add a sibling action button using a small double-arrow icon with the same visual treatment and hover behavior.

Behavior rules:

- Render the fork button only for assistant messages
- Render it only when the assistant message is fully materialized, not for streaming placeholders
- Place it immediately beside the copy button
- Disable it while the fork request is in flight for that message

The button should feel like a secondary utility action, not a primary CTA.

### Success flow

- Clicking fork sends a single request to the fork endpoint
- On success, the client navigates to `/chat/<newConversationId>`
- The new conversation loads through the existing chat page and sidebar mechanisms

### Error handling

- If the request fails, the app stays on the current conversation
- Show a small local error state or toast-style message rather than redirecting
- No partially created fork should remain visible if cloning fails

## Data Copy Semantics

The copy must produce a new independent conversation with newly generated IDs for cloned rows. Nothing should be shared by reference between the original conversation and the fork.

### Conversation row

Create a fresh conversation row with:

- a new conversation ID
- the same `user_id`
- the same `folder_id`
- the same `provider_profile_id`
- manual conversation origin
- a fresh `created_at` and `updated_at`
- `is_active = false`

The fork should not duplicate the original title verbatim. It should use the normal default title generation behavior so the new branch can acquire its own title and remain distinguishable in the sidebar.

### Message prefix

Clone each message from the beginning of the source conversation through the selected assistant message, preserving:

- role
- content
- thinking content
- status
- estimated tokens
- system kind
- compacted timestamp
- relative ordering

Each cloned message gets a new message ID and the new `conversation_id`.

### Per-message detail

For every copied message, also clone:

- `message_actions`, remapping `message_id`
- `message_text_segments`, remapping `message_id`
- `message_attachments` associations and referenced attachment metadata needed for rendering in the fork

The fork must display copied images/files exactly as the original prefix did.

### Compaction state

Copy compaction artifacts conservatively:

- copy `memory_nodes` only if their covered source range falls entirely within the retained message prefix
- copy `compaction_events` only if they reference copied nodes and do not depend on discarded tail messages

If a compaction artifact spans beyond the branch point, omit it from the fork. The cloned conversation must not contain summary state that depends on excluded messages.

## Implementation Shape

### Server

Primary implementation surfaces:

- [app/api/messages/[messageId]/route.ts](/Users/charles/.codex/worktrees/4dc4/Eidon-AI/app/api/messages/[messageId]/route.ts)
- [lib/conversations.ts](/Users/charles/.codex/worktrees/4dc4/Eidon-AI/lib/conversations.ts)

Recommended structure:

- add a new message fork API handler at `app/api/messages/[messageId]/fork/route.ts`
- add a dedicated conversation helper in `lib/conversations.ts` such as `forkConversationFromMessage`
- keep all row cloning and ID remapping in the data layer rather than inside the route

The data-layer helper should run transactionally so the fork is all-or-nothing.

### Client

Primary implementation surfaces:

- [components/message-bubble.tsx](/Users/charles/.codex/worktrees/4dc4/Eidon-AI/components/message-bubble.tsx)
- [components/chat-view.tsx](/Users/charles/.codex/worktrees/4dc4/Eidon-AI/components/chat-view.tsx)

Recommended structure:

- extend the assistant message action row with a fork callback
- let `ChatView` own the request and navigation behavior, since it already manages message mutations and routing concerns
- keep the UI unaware of cloning rules beyond "request fork for this message"

## Edge Cases

- Reject attempts to fork a non-assistant message
- Reject attempts to fork a message the user does not own
- Reject attempts to fork a missing message
- Do not show the fork button for streaming assistant placeholders
- If the selected assistant message is the last message in the conversation, the fork is still valid and produces a full prefix clone
- If attachments or compaction artifacts cannot be copied consistently, fail the fork and roll back rather than creating a degraded partial clone

## Testing

### Data-layer coverage

- Forking clones messages only through the selected assistant message
- Cloned rows receive fresh IDs
- Message actions, text segments, and attachment associations are remapped to cloned message IDs
- Eligible memory nodes and compaction events are copied only when fully contained in the retained prefix
- The transaction rolls back cleanly on failure

### API coverage

- Authorized user can fork an assistant message successfully
- Requests for missing messages return `404`
- Requests for non-assistant messages return `400`
- Requests for messages owned by another user are rejected

### UI coverage

- Assistant messages render the fork button next to copy
- User messages do not render the fork button
- Clicking fork disables the control during submission
- Successful fork redirects to the new `/chat/<id>` route
- Failed fork leaves the user in place and surfaces an error

### Manual validation

- Fork a middle assistant message and confirm the new conversation excludes all later turns
- Confirm copied thinking content, tool rows, and attachments render correctly in the fork
- Confirm the original conversation remains unchanged
- Confirm the new conversation appears in the sidebar and opens correctly after navigation

## Risks

- The main correctness risk is incomplete remapping across related tables, especially attachments and compaction artifacts
- A second risk is accidentally copying summary state that depends on excluded tail messages
- A UX risk is duplicate submissions if the fork control is not disabled during the request

Keeping the copy logic server-side and transactional is the key mitigation for all three risks.

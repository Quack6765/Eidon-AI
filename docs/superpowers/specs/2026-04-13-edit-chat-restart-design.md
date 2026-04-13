# Edit Chat Restart Design

**Date:** 2026-04-13
**Status:** Draft

## Summary

Allow users to edit one of their own previous chat messages directly in the transcript and restart the conversation from that exact point. When the user saves the edit, the app should update that user message in place, immediately remove every later message in the same conversation, and generate a fresh assistant reply from the edited turn.

This is an in-place history rewrite, not a fork. Assistant messages remain immutable and never expose an edit affordance.

## Goals

- Let users correct or refine an earlier prompt without creating a new conversation
- Make the edit affordance lightweight and directly attached to user bubbles
- Preserve the edited message's existing attachments when restarting from history
- Keep destructive history changes transactional and server-authored
- Reuse the existing streaming chat path after the edit is accepted

## Non-Goals

- Editing assistant messages
- Showing a confirmation dialog before deleting later turns
- Inserting a second replacement user bubble
- Creating a forked or hidden replacement conversation
- Re-attaching files manually after an edit when the files already belong to the edited message
- Redesigning the broader chat composer or transcript layout

## Product Decisions

### Editable scope

- Only user messages are editable
- Assistant messages never show a pen icon and cannot be modified
- The edit affordance appears on completed user messages in the existing utility action row under the bubble

### Restart semantics

- Saving an edited historical user message rewrites that message in place
- All later messages in the same conversation are deleted immediately with no confirmation step
- The edited message stays in the same position in the transcript
- A fresh assistant turn is generated from the retained prefix of the conversation

### Attachment behavior

- The edited message keeps its existing attachments automatically
- The restart request reuses the attachment bindings already attached to that message
- No later-message attachments are preserved unless they belong to the edited message itself

### User experience

- The user sees the edit inline inside the original bubble
- Saving uses a busy state on the action row
- Later bubbles disappear after the restart succeeds
- The normal assistant streaming experience resumes from that point
- There is no "edited" badge, no system notice, and no duplicate bubble

## Recommended Approach

Implement the feature as a dedicated server-side restart endpoint scoped to the selected user message:

- `POST /api/messages/[messageId]/edit-restart`

This endpoint should:

1. Authenticate the user
2. Load the target message and verify ownership through the parent conversation
3. Reject non-user messages
4. Update the message content and token estimate in place
5. Delete every later message in the conversation inside the same transaction
6. Remove dependent retained-context artifacts that reference deleted history
7. Start a fresh assistant turn from the retained message prefix using the existing chat runtime
8. Return enough state for the client to reconcile and display the restarted turn

This keeps the destructive behavior authoritative on the server, avoids client-side transcript surgery as the source of truth, and fits the existing split where `ChatView` owns interaction and `lib/conversations.ts` owns persisted state.

## UX Design

### User message affordance

The existing user bubble action row in [components/message-bubble.tsx](/Users/charles/conductor/workspaces/Eidon-AI/cairo/components/message-bubble.tsx) already supports inline editing. Keep that inline editing model and convert its save behavior into an edit-and-restart action for transcript rewrites.

Behavior rules:

- Show the pen icon only on user messages
- Keep the pen icon visually aligned with the existing copy button
- Do not render any edit action on assistant messages
- Use the existing textarea editing experience inside the bubble
- Disable save and cancel while the restart request is being submitted

### Save behavior

- Clicking save on an edited user message sends a single restart request
- There is no confirmation modal
- On success, the transcript should reflect the edited message and remove every later turn
- The new assistant reply should appear through the normal streaming UI, not as a special-case layout

### Failure behavior

- If the restart request fails, the app stays in the current conversation
- The user should see an error in the existing chat-level error area
- The transcript should not be partially truncated on failure
- The bubble should return to a coherent state, either staying editable or restoring the prior visible content, with no half-applied rewrite

## Data Semantics

The retained conversation after save is the original conversation with rewritten history, not a clone.

### Edited message

Update the selected user message in place, preserving:

- `id`
- `conversation_id`
- `created_at`
- attachment bindings on that message

Update:

- `content`
- `estimated_tokens`

Do not create a new message row for the edited user turn.

### Tail deletion

Delete every message in the same conversation that occurs after the edited user message. "After" should be determined using the conversation's chronological ordering, which is currently represented by message `created_at` and stable persisted IDs.

Deleting later messages must also remove dependent rows tied to those messages:

- `message_actions`
- `message_text_segments`
- `message_attachments` for deleted messages via cascade

The edited message's attachments remain bound to the edited message and are not re-created.

### Compaction state

Any retained-context artifacts that depend on deleted history must be removed before the assistant is asked to continue. In practice:

- delete `memory_nodes` whose summarized source range includes any deleted message
- delete `compaction_events` whose source range includes any deleted message or whose node is deleted

The retained conversation must not include summary state derived from discarded messages.

## Implementation Shape

### Server

Primary implementation surfaces:

- [app/api/messages/[messageId]/route.ts](/Users/charles/conductor/workspaces/Eidon-AI/cairo/app/api/messages/[messageId]/route.ts)
- [app/api/conversations/[conversationId]/chat/route.ts](/Users/charles/conductor/workspaces/Eidon-AI/cairo/app/api/conversations/[conversationId]/chat/route.ts)
- [lib/conversations.ts](/Users/charles/conductor/workspaces/Eidon-AI/cairo/lib/conversations.ts)

Recommended structure:

- keep `PATCH /api/messages/[messageId]` as the non-destructive content update route
- add a new route at `app/api/messages/[messageId]/edit-restart/route.ts`
- add a transactional helper in `lib/conversations.ts`, such as `rewriteConversationFromEditedUserMessage`
- keep message rewriting, tail deletion, and context cleanup in the data layer rather than the route
- reuse the existing assistant generation path after the rewrite rather than building a second streaming implementation

One practical shape is to move the shared assistant-turn startup logic behind a helper callable from both the normal chat route and the edit-restart route.

### Client

Primary implementation surfaces:

- [components/message-bubble.tsx](/Users/charles/conductor/workspaces/Eidon-AI/cairo/components/message-bubble.tsx)
- [components/chat-view.tsx](/Users/charles/conductor/workspaces/Eidon-AI/cairo/components/chat-view.tsx)

Recommended structure:

- keep the inline bubble editor inside `MessageBubble`
- add a dedicated callback for destructive restart saves instead of overloading the current simple update handler
- let `ChatView` own request dispatch, optimistic transcript trimming, error presentation, and streaming reset
- lock the composer while a restart request is in flight so a second user submission cannot race with the rewrite

## Edge Cases

- Reject editing a missing message
- Reject editing a message owned by another user
- Reject editing an assistant message
- If the edited message is the latest user message, the flow still uses the same restart path; there is simply no transcript tail to delete
- If the conversation currently has an active assistant turn, reject the edit-restart request with `409` rather than trying to interrupt and rewrite an in-flight turn
- If cleanup of dependent history fails, roll back the rewrite and keep the original conversation intact

## Testing

### Data-layer coverage

- Rewriting a user message updates only that row's editable fields
- Later messages are deleted and earlier messages remain untouched
- Attachments on the edited message are preserved
- Attachments belonging only to deleted later messages are removed
- Dependent `message_actions` and `message_text_segments` for deleted messages are removed
- `memory_nodes` and `compaction_events` whose ranges cross into deleted history are removed
- The transaction rolls back on failure

### API coverage

- Authorized user can restart from a valid user message
- Requests for missing messages return `404`
- Requests for assistant messages return `400`
- Requests for messages owned by another user are rejected
- Concurrent active-turn restart requests return `409`

### UI coverage

- User messages render the edit button
- Assistant messages do not render the edit button
- Saving an edited older message triggers the restart flow rather than the plain patch flow
- Later transcript messages disappear after a successful restart
- The assistant streaming state resets and resumes correctly after restart
- Failed restart requests keep the prior transcript visible and surface an error

### Manual validation

- Edit a middle user message and confirm all later turns disappear
- Confirm the edited user message keeps its original attachments
- Confirm the assistant regenerates from the edited point
- Confirm assistant messages never show a pen icon
- Confirm saving does not show a confirmation dialog
- Confirm the composer cannot submit another message during the restart request

## Risks

- The main correctness risk is incomplete cleanup of retained-context artifacts after tail deletion
- A second risk is racing the rewrite against an already-active assistant stream
- A UX risk is allowing the client to locally trim history before the server has accepted the transaction

The mitigation is to keep the rewrite transactional in the data layer, make the restart contract explicit, and cover both transcript and context cleanup in tests.

# Memory Approval Design

## Summary

Replace silent memory mutations with explicit inline approvals in chat. When the assistant wants to create, update, or delete a memory, Eidon should persist a pending memory proposal in the assistant timeline instead of mutating `user_memories` immediately. The user can then `Save`, `Ignore`, or `Edit` the proposal inline.

This keeps memory changes visible, reviewable, and reversible at the point where they were suggested, which is a better fit for power users who care about long-lived context quality.

## Goals

- Require user approval for every memory mutation: create, update, and delete
- Keep the approval UI inline inside the assistant message timeline
- Preserve proposals across refreshes and reconnects
- Avoid resuming or re-running the assistant turn when the user approves or ignores a proposal
- Reuse the existing action timeline model where possible

## Non-Goals

- Batch review of multiple memory proposals in Settings
- Re-asking the model to rewrite or justify proposals after the turn finishes
- A separate notification center for memory proposals
- Undo/rollback history for already-applied memory changes

## Recommended Approach

Persist memory proposals as first-class `MessageAction` records with a new `pending` status and enough structured metadata to apply the change later. The assistant still “calls” memory tools, but the runtime converts each memory tool call into a pending proposal instead of executing the mutation immediately.

Approval and dismissal happen through normal API mutations initiated by the user from the chat UI. These actions directly apply or dismiss the proposal on the server and then update the existing action row in place.

## Why This Approach

- It fits the current chat timeline architecture in `components/message-bubble.tsx` and `lib/conversations.ts`
- It keeps memory proposals attached to the exact assistant turn that created them
- It survives page reloads because proposals are persisted in `message_actions`
- It avoids introducing a second queueing or notification system for a feature that is fundamentally conversational
- It minimizes risk by keeping approval logic outside the already-completed assistant turn

## Data Model

### Extend `MessageActionStatus`

Add a new status:

- `pending` — awaiting user approval or dismissal

Existing statuses remain unchanged:

- `running`
- `completed`
- `error`
- `stopped`

### Add proposal metadata to `message_actions`

Add nullable columns:

- `proposal_state` — `pending`, `approved`, `dismissed`, `superseded`
- `proposal_payload_json` — structured JSON describing the pending memory mutation
- `proposal_updated_at` — ISO timestamp for the last proposal state change

`proposal_payload_json` should contain:

```json
{
  "operation": "create" | "update" | "delete",
  "targetMemoryId": "mem_123 or null",
  "currentMemory": {
    "id": "mem_123",
    "content": "Current persisted memory",
    "category": "work"
  },
  "proposedMemory": {
    "content": "New memory content",
    "category": "preference"
  }
}
```

Notes:

- `currentMemory` is only present for update/delete proposals
- `proposedMemory` is present for create/update proposals
- For delete proposals, `proposedMemory` is omitted

## Runtime Behavior

### Tool definitions

The assistant should keep using the existing memory tools:

- `create_memory`
- `update_memory`
- `delete_memory`

The tool contract remains the same from the model’s perspective so prompting and compaction guidance stay mostly intact.

### Execution semantics

Memory tool handlers in `lib/assistant-runtime.ts` change from “apply immediately” to “create proposal”.

#### `create_memory`

Current behavior:

- validates content/category
- checks memory count limit
- creates a `user_memories` row immediately

New behavior:

- validates content/category
- checks whether the current count already exceeds the configured limit
- persists a pending proposal action
- returns a tool result like `Memory change proposed for approval`

#### `update_memory`

Current behavior:

- fetches the target memory
- updates it immediately

New behavior:

- fetches the target memory
- persists a pending update proposal containing both the current and proposed values
- returns a tool result like `Memory update proposed for approval`

#### `delete_memory`

Current behavior:

- fetches the target memory
- deletes it immediately

New behavior:

- fetches the target memory
- persists a pending delete proposal containing the current value to be removed
- returns a tool result like `Memory deletion proposed for approval`

### Timeline presentation during streaming

When the assistant proposes a memory change:

- `onActionStart` creates a `MessageAction` with status `pending`
- there is no later `running -> completed` transition for that proposal during the turn
- the assistant message finishes normally after the proposal appears

This is intentionally different from shell/MCP actions because the work has shifted from assistant execution to user review.

## UI

### Assistant message timeline

Render pending memory proposals as special inline cards instead of generic collapsible action rows.

Each card should show:

- operation label: `Save memory`, `Update memory`, `Delete memory`
- proposal summary
- `before` and `after` content when applicable
- category chip for create/update
- current proposal state

### User actions

Pending proposals expose:

- `Save` — apply proposal as-is
- `Ignore` — dismiss proposal without changing memories
- `Edit` — switch card into inline edit mode before saving

### Edit mode

For create/update proposals:

- editable textarea for content
- editable category selector
- `Save`
- `Cancel`

For delete proposals:

- no content/category editing
- only `Delete memory` confirmation and `Cancel`

### Final states

After resolution:

- approved proposal becomes a compact completed card
- dismissed proposal becomes a compact ignored card
- failed approval becomes an error card with the reason

## API Surface

Add a dedicated message-action mutation route:

- `POST /api/message-actions/[actionId]/approve`
- `POST /api/message-actions/[actionId]/dismiss`

Approval route behavior:

- verify current user owns the message/conversation
- verify action is a pending memory proposal
- optionally accept edited `content` and `category` for create/update
- re-validate against current memory state
- apply the change to `user_memories`
- update the action row to `completed` plus `proposal_state=approved`
- return the updated `MessageAction`

Dismiss route behavior:

- verify ownership
- verify action is a pending memory proposal
- update action to `completed` plus `proposal_state=dismissed`
- do not mutate `user_memories`
- return the updated `MessageAction`

## Validation and Conflict Handling

Approval should validate against current state, not the state that existed when the assistant made the proposal.

### Create

- re-check memory limit at approval time
- reject if the edited content is empty

### Update

- reject if target memory no longer exists
- reject if edited content is empty

### Delete

- reject if target memory no longer exists

### User-facing conflict cases

- `This memory no longer exists`
- `Memory limit reached`
- `Edited memory content cannot be empty`

Rejected approvals should mark the proposal action as `error` and keep enough information in the card for the user to understand what failed.

## Prompting and Context

The prompt guidance in `lib/compaction.ts` should change from “the user can see and manage all memories in settings” to “the user must approve memory changes proposed by you”.

Suggested update:

```text
You have access to memory tools (create_memory, update_memory, delete_memory) to propose durable facts about the user across conversations. Use these conservatively — only for facts likely to matter again. Do not save transient task details. Memory changes are not applied immediately: the user reviews and approves or dismisses each proposal inline in chat.
```

This should reduce the chance that the model assumes successful persistence before approval.

## Files and Responsibilities

### Persistence

- `lib/db.ts`
  Add `message_actions` columns and migration logic
- `lib/types.ts`
  Add `pending` status and proposal metadata types
- `lib/conversations.ts`
  Read/write proposal payload fields in `createMessageAction` and `updateMessageAction`

### Runtime

- `lib/assistant-runtime.ts`
  Convert memory tool executors from immediate mutations to proposal creation
- `lib/provider.ts`
  Ensure Copilot-side tool execution maps memory actions to pending proposals too
- `lib/copilot-tools.ts`
  Mirror the same proposal semantics for the Copilot provider path

### API

- `app/api/message-actions/[actionId]/approve/route.ts`
  Apply pending proposal
- `app/api/message-actions/[actionId]/dismiss/route.ts`
  Dismiss pending proposal

### UI

- `components/message-bubble.tsx`
  Render pending memory proposal cards and inline edit/approve/dismiss controls
- `components/chat-view.tsx`
  Wire proposal action mutations and reconcile returned action state into message timeline

## Testing

### Unit tests

- proposal payload creation for create/update/delete
- approval applies the expected `user_memories` mutation
- dismissal leaves memories unchanged
- approval-time validation for missing memory and memory limit conflicts

### Integration tests

- assistant proposes create/update/delete and action persists as pending
- approving a proposal updates the action row and memory store
- dismissing a proposal updates the action row and leaves memory store unchanged

### UI tests

- pending proposal card renders inline
- edit mode works for create/update
- delete proposal shows confirmation-style UI
- completed and dismissed cards render correctly after mutation

## Rollout Notes

- Existing completed memory actions remain valid and should continue rendering normally
- Pending status is only used for new proposal-based memory actions
- No backfill is required for current `user_memories`

## Risks

- Adding proposal metadata to `message_actions` makes the generic action model more stateful
- The assistant may propose too many memories if the updated prompt wording is not strict enough
- Copilot and non-Copilot runtime paths must stay behaviorally aligned

## Open Decision

Use the same timeline/action substrate for memory proposals rather than introducing a parallel “memory suggestion” entity. This keeps the implementation smaller and the UX more coherent with existing visible tool activity.

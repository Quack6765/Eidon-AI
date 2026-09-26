import type Database from "better-sqlite3";
import { truncateText } from "@/lib/bounded-text";
import { RESTART_RESUME_NOTICE_HEADER } from "@/lib/constants";
import { getConversationOwnerId, listMessageActionsForMessageIds } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import type { MessageAction } from "@/lib/types";

export const MAX_CONSECUTIVE_RESTART_RESUMES = 2;

const INTERRUPTED_BY_RESTART = "Interrupted by a server restart";
const STOPPED_APPROVAL_SUMMARY = "Approval request stopped by a server restart";
const RESUMABLE_DELEGATED_RUN = "trigger_source = 'delegated' AND prompt IS NOT NULL";
const WAITING_BOT_RUN_STATUSES = "'waiting_user', 'waiting_approval'";
const ACTION_DETAIL_CHARS = 200;

export function reconcileInterruptedRuntimeState(
  db: Database.Database,
  timestamp = new Date().toISOString()
) {
  const transaction = db.transaction(() => {
    const conversations = db
      .prepare("UPDATE conversations SET is_active = 0 WHERE is_active = 1")
      .run().changes;

    const interruptedMessages = db
      .prepare("SELECT id, conversation_id FROM messages WHERE status = 'streaming'")
      .all() as Array<{ id: string; conversation_id: string }>;
    const readSegments = db.prepare(
      "SELECT content FROM message_text_segments WHERE message_id = ? ORDER BY sort_order ASC, created_at ASC"
    );
    const hasActions = db.prepare("SELECT 1 FROM message_actions WHERE message_id = ? LIMIT 1");
    const keepPartialMessage = db.prepare("UPDATE messages SET status = 'stopped', content = ? WHERE id = ?");
    const failEmptyMessage = db.prepare("UPDATE messages SET status = 'error' WHERE id = ?");
    for (const message of interruptedMessages) {
      const content = (readSegments.all(message.id) as Array<{ content: string }>)
        .map((segment) => segment.content)
        .join("");
      if (content.trim() || hasActions.get(message.id)) {
        keepPartialMessage.run(content, message.id);
      } else {
        failEmptyMessage.run(message.id);
      }
    }

    const actions = db
      .prepare(
        `UPDATE message_actions
         SET status = 'error',
             detail = CASE WHEN detail = '' THEN ? ELSE detail END,
             result_summary = CASE WHEN result_summary = '' THEN ? ELSE result_summary END,
             completed_at = COALESCE(completed_at, ?)
         WHERE status = 'running'`
      )
      .run(INTERRUPTED_BY_RESTART, INTERRUPTED_BY_RESTART, timestamp).changes;
    const titles = db
      .prepare(
        `UPDATE conversations
         SET title_generation_status = 'failed'
         WHERE title_generation_status = 'running'`
      )
      .run().changes;
    const queuedMessages = db
      .prepare(
        `UPDATE queued_messages
         SET status = 'pending',
             processing_started_at = NULL,
             updated_at = ?
         WHERE status = 'processing'`
      )
      .run(timestamp).changes;
    const automationRuns = db
      .prepare("UPDATE automation_runs SET status = 'queued' WHERE status = 'running'")
      .run().changes;
    db.prepare(
      `UPDATE automations
       SET last_status = 'queued',
           updated_at = ?
       WHERE last_status = 'running'`
    ).run(timestamp);
    const delegatedRuns = db
      .prepare(
        `UPDATE bot_runs
         SET status = 'queued'
         WHERE ${RESUMABLE_DELEGATED_RUN} AND status IN ('running', ${WAITING_BOT_RUN_STATUSES})`
      )
      .run().changes;
    const botRuns = db
      .prepare(
        `UPDATE bot_runs
         SET status = 'stopped',
             error_message = ?,
             finished_at = COALESCE(finished_at, ?)
         WHERE status IN ('queued', 'running', ${WAITING_BOT_RUN_STATUSES}) AND NOT (${RESUMABLE_DELEGATED_RUN})`
      )
      .run(INTERRUPTED_BY_RESTART, timestamp).changes;
    const delegationActions = db
      .prepare(
        `UPDATE message_actions
         SET status = 'error',
             result_summary = 'The bot run was interrupted by a server restart.',
             completed_at = COALESCE(completed_at, ?)
         WHERE status = 'pending' AND kind IN ('message_bot', 'delegate_task')
           AND id NOT IN (
             SELECT reply_action_id FROM bot_runs
             WHERE status = 'queued' AND reply_action_id IS NOT NULL AND ${RESUMABLE_DELEGATED_RUN}
           )`
      )
      .run(timestamp).changes;
    const toolApprovals = db
      .prepare(
        `UPDATE message_actions
         SET status = 'completed',
             result_summary = ?,
             completed_at = COALESCE(completed_at, ?),
             proposal_state = 'dismissed',
             proposal_payload_json = json_set(COALESCE(proposal_payload_json, '{}'), '$.resolution', 'stopped'),
             proposal_updated_at = ?
         WHERE status = 'pending' AND kind = 'tool_approval' AND proposal_state = 'pending'`
      )
      .run(STOPPED_APPROVAL_SUMMARY, timestamp, timestamp).changes;

    const ownedConversationIds = new Set(
      (
        db
          .prepare(
            `SELECT conversation_id FROM automation_runs WHERE status = 'queued' AND conversation_id IS NOT NULL
             UNION
             SELECT conversation_id FROM bot_runs
             WHERE status = 'queued' AND started_at IS NOT NULL AND ${RESUMABLE_DELEGATED_RUN}`
          )
          .all() as Array<{ conversation_id: string }>
      ).map((row) => row.conversation_id)
    );
    const conversationIds = [
      ...new Set(interruptedMessages.map((message) => message.conversation_id))
    ].filter((conversationId) => !ownedConversationIds.has(conversationId));

    return {
      conversations,
      messages: interruptedMessages.length,
      actions,
      titles,
      queuedMessages,
      automationRuns,
      delegatedRuns,
      botRuns,
      delegationActions,
      toolApprovals,
      conversationIds
    };
  });

  return transaction.immediate();
}

function describeAction(action: MessageAction) {
  return `- ${action.label}${action.detail ? `: ${truncateText(action.detail, ACTION_DETAIL_CHARS)}` : ""}`;
}

export function buildRestartResumeNotice(conversationId: string, task?: string | null): string | null {
  const db = getDb();
  const recentUserMessages = db
    .prepare(
      `SELECT content FROM messages
       WHERE conversation_id = ? AND role = 'user'
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(conversationId, MAX_CONSECUTIVE_RESTART_RESUMES) as Array<{ content: string }>;
  if (
    recentUserMessages.length === MAX_CONSECUTIVE_RESTART_RESUMES &&
    recentUserMessages.every((message) => message.content.startsWith(RESTART_RESUME_NOTICE_HEADER))
  ) {
    return null;
  }

  const latestAssistant = db
    .prepare(
      `SELECT id FROM messages
       WHERE conversation_id = ? AND role = 'assistant'
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`
    )
    .get(conversationId) as { id: string } | undefined;
  const actions = latestAssistant ? listMessageActionsForMessageIds([latestAssistant.id]) : [];
  const interruptedSteps = actions.filter(
    (action) => action.kind !== "tool_approval" && action.resultSummary === INTERRUPTED_BY_RESTART
  );
  const cancelledApprovals = actions.filter(
    (action) => action.kind === "tool_approval" && action.resultSummary === STOPPED_APPROVAL_SUMMARY
  );

  const lines = [
    RESTART_RESUME_NOTICE_HEADER,
    "The server restarted while you were working, so your previous reply was cut off. Continue from where you left off instead of starting over."
  ];
  if (interruptedSteps.length) {
    lines.push(
      "",
      "These steps were still running and may or may not have finished — check their result before repeating them:",
      ...interruptedSteps.map(describeAction)
    );
  }
  if (cancelledApprovals.length) {
    lines.push(
      "",
      "These approval requests were cancelled — ask again if you still need them:",
      ...cancelledApprovals.map(describeAction)
    );
  }
  if (task) {
    lines.push("", "The task you were working on:", task);
  }
  lines.push("", "(Automated notice: the user did not write this message.)");
  return lines.join("\n");
}

export async function resumeInterruptedWork(conversationIds: string[]) {
  const { deliverWakeMessage, resumeDelegations } = await import("@/lib/bot-delegation");

  for (const conversationId of conversationIds) {
    const content = buildRestartResumeNotice(conversationId);
    if (!content) {
      console.warn(`[resume] Not resuming ${conversationId}: it was interrupted by repeated server restarts`);
      continue;
    }
    void deliverWakeMessage({
      recipientConversationId: conversationId,
      ownerUserId: getConversationOwnerId(conversationId),
      content,
      recordBotRun: true
    })
      .then((result) => {
        if (result.status === "failed" || result.status === "skipped") {
          console.error(`[resume] Unable to resume ${conversationId}: ${result.errorMessage}`);
        }
      })
      .catch((error: unknown) => {
        console.error(`[resume] Unable to resume ${conversationId}`, error);
      });
  }

  resumeDelegations();
}

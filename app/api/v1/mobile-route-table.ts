import * as accountRoute from "@/app/api/auth/account/route";
import * as automationRunRoute from "@/app/api/automation-runs/[runId]/route";
import * as automationRunRetryRoute from "@/app/api/automation-runs/[runId]/retry/route";
import * as automationRoute from "@/app/api/automations/[automationId]/route";
import * as automationRunNowRoute from "@/app/api/automations/[automationId]/run-now/route";
import * as automationRunsRoute from "@/app/api/automations/[automationId]/runs/route";
import * as automationsRoute from "@/app/api/automations/route";
import * as attachmentRoute from "@/app/api/attachments/[attachmentId]/route";
import * as attachmentsRoute from "@/app/api/attachments/route";
import * as avatarRoute from "@/app/api/avatars/[seed]/route";
import * as botApprovalsRoute from "@/app/api/bots/approvals/route";
import * as botRoute from "@/app/api/bots/[botId]/route";
import * as botClearContextRoute from "@/app/api/bots/[botId]/clear-context/route";
import * as botMemoriesRoute from "@/app/api/bots/[botId]/memories/route";
import * as botReadRoute from "@/app/api/bots/[botId]/read/route";
import * as botResetBrowserRoute from "@/app/api/bots/[botId]/reset-browser-session/route";
import * as botRunStopRoute from "@/app/api/bots/[botId]/runs/[runId]/stop/route";
import * as botSkillRoute from "@/app/api/bots/[botId]/skills/[skillId]/route";
import * as botSkillsRoute from "@/app/api/bots/[botId]/skills/route";
import * as botSkillsMaintenanceRoute from "@/app/api/bots/[botId]/skills/maintenance/route";
import * as botStopRoute from "@/app/api/bots/[botId]/stop/route";
import * as botWorkspaceRoute from "@/app/api/bots/[botId]/workspace/route";
import * as botWorkspaceFileRoute from "@/app/api/bots/[botId]/workspace/file/route";
import * as botsRoute from "@/app/api/bots/route";
import * as composerReferencesRoute from "@/app/api/composer/references/route";
import * as conversationRoute from "@/app/api/conversations/[conversationId]/route";
import * as conversationChatRoute from "@/app/api/conversations/[conversationId]/chat/route";
import * as conversationComputerRoute from "@/app/api/conversations/[conversationId]/computer/route";
import * as conversationComputerControlRoute from "@/app/api/conversations/[conversationId]/computer/control/route";
import * as conversationResearchRoute from "@/app/api/conversations/[conversationId]/research/route";
import * as conversationShareRoute from "@/app/api/conversations/[conversationId]/share/route";
import * as conversationsRoute from "@/app/api/conversations/route";
import * as conversationSearchRoute from "@/app/api/conversations/search/route";
import * as folderRoute from "@/app/api/folders/[folderId]/route";
import * as foldersRoute from "@/app/api/folders/route";
import * as mcpServerRoute from "@/app/api/mcp-servers/[serverId]/route";
import * as mcpServerOAuthRoute from "@/app/api/mcp-servers/[serverId]/oauth/route";
import * as mcpServerOAuthFlowsRoute from "@/app/api/mcp-servers/[serverId]/oauth/flows/route";
import * as mcpServersRoute from "@/app/api/mcp-servers/route";
import * as mcpServersTestRoute from "@/app/api/mcp-servers/test/route";
import * as memoryRoute from "@/app/api/memories/[memoryId]/route";
import * as memoriesRoute from "@/app/api/memories/route";
import * as messageActionApproveRoute from "@/app/api/message-actions/[actionId]/approve/route";
import * as messageActionDismissRoute from "@/app/api/message-actions/[actionId]/dismiss/route";
import * as messageActionSecretRoute from "@/app/api/message-actions/[actionId]/secret/route";
import * as savedLoginRoute from "@/app/api/saved-logins/[loginId]/route";
import * as savedLoginsRoute from "@/app/api/saved-logins/route";
import * as messageRoute from "@/app/api/messages/[messageId]/route";
import * as messageEditRestartRoute from "@/app/api/messages/[messageId]/edit-restart/route";
import * as messageForkRoute from "@/app/api/messages/[messageId]/fork/route";
import * as messageRewindRoute from "@/app/api/messages/[messageId]/rewind/route";
import * as messageRegenerateRoute from "@/app/api/messages/[messageId]/regenerate/route";
import * as messageRetryRoute from "@/app/api/messages/[messageId]/retry/route";
import * as onboardingRoute from "@/app/api/onboarding/route";
import * as personaRoute from "@/app/api/personas/[personaId]/route";
import * as personasRoute from "@/app/api/personas/route";
import * as pushSubscribeRoute from "@/app/api/push/subscribe/route";
import * as pushVapidRoute from "@/app/api/push/vapid/route";
import * as pushoverRoute from "@/app/api/pushover/route";
import * as researchPlanRoute from "@/app/api/research/plan/route";
import * as providerConnectionRoute from "@/app/api/providers/[profileId]/connection/route";
import * as providerConnectionFlowsRoute from "@/app/api/providers/[profileId]/connection/flows/route";
import * as providerConnectionFlowRoute from "@/app/api/providers/[profileId]/connection/flows/[flowId]/route";
import * as providerModelsRoute from "@/app/api/providers/[profileId]/models/route";
import * as generalSettingsRoute from "@/app/api/settings/general/route";
import * as providerDuplicateRoute from "@/app/api/settings/providers/duplicate/route";
import * as providerSettingsRoute from "@/app/api/settings/providers/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as semanticRecallSettingsRoute from "@/app/api/settings/semantic-recall/route";
import * as settingsTestRoute from "@/app/api/settings/test/route";
import * as titleGenerationSettingsRoute from "@/app/api/settings/title-generation/route";
import * as skillRoute from "@/app/api/skills/[skillId]/route";
import * as skillsRoute from "@/app/api/skills/route";
import * as skillsMaintenanceRoute from "@/app/api/skills/maintenance/route";
import * as skillCuratorLedgerRoute from "@/app/api/skills/curator/ledger/route";
import * as skillCuratorPurgeRoute from "@/app/api/skills/curator/purge/route";
import * as skillCuratorRollbackRoute from "@/app/api/skills/curator/rollback/route";
import * as speechCleanupRoute from "@/app/api/speech/transcription/cleanup/route";
import * as speechPrepareRoute from "@/app/api/speech/transcription/prepare/route";
import * as speechTranscribeRoute from "@/app/api/speech/transcription/transcribe/route";
import * as toolApprovalRoute from "@/app/api/tool-approvals/[ruleId]/route";
import * as toolApprovalsRoute from "@/app/api/tool-approvals/route";
import * as userRoute from "@/app/api/users/[userId]/route";
import * as usersRoute from "@/app/api/users/route";
import * as whatsNewRoute from "@/app/api/whats-new/route";

export type RouteContext = { params: Promise<Record<string, string>> };
export type RouteHandler = (request: Request, context: RouteContext) => Response | Promise<Response>;
export type RouteModule = Record<string, unknown>;

export const mobileGatewayRoutes: Array<{ pattern: string[]; module: RouteModule }> = [
  { pattern: ["auth", "account"], module: accountRoute },
  { pattern: ["conversations", "search"], module: conversationSearchRoute },
  { pattern: ["conversations"], module: conversationsRoute },
  { pattern: ["composer", "references"], module: composerReferencesRoute },
  { pattern: ["conversations", ":conversationId", "chat"], module: conversationChatRoute },
  { pattern: ["conversations", ":conversationId", "computer", "control"], module: conversationComputerControlRoute },
  { pattern: ["conversations", ":conversationId", "computer"], module: conversationComputerRoute },
  { pattern: ["conversations", ":conversationId", "research"], module: conversationResearchRoute },
  { pattern: ["conversations", ":conversationId", "share"], module: conversationShareRoute },
  { pattern: ["conversations", ":conversationId"], module: conversationRoute },
  { pattern: ["research", "plan"], module: researchPlanRoute },
  { pattern: ["folders"], module: foldersRoute },
  { pattern: ["folders", ":folderId"], module: folderRoute },
  { pattern: ["attachments"], module: attachmentsRoute },
  { pattern: ["attachments", ":attachmentId"], module: attachmentRoute },
  { pattern: ["avatars", ":seed"], module: avatarRoute },
  { pattern: ["bots", "approvals"], module: botApprovalsRoute },
  { pattern: ["bots", ":botId", "clear-context"], module: botClearContextRoute },
  { pattern: ["bots", ":botId", "memories"], module: botMemoriesRoute },
  { pattern: ["bots", ":botId", "read"], module: botReadRoute },
  { pattern: ["bots", ":botId", "reset-browser-session"], module: botResetBrowserRoute },
  { pattern: ["bots", ":botId", "runs", ":runId", "stop"], module: botRunStopRoute },
  { pattern: ["bots", ":botId", "skills"], module: botSkillsRoute },
  { pattern: ["bots", ":botId", "skills", "maintenance"], module: botSkillsMaintenanceRoute },
  { pattern: ["bots", ":botId", "skills", ":skillId"], module: botSkillRoute },
  { pattern: ["bots", ":botId", "stop"], module: botStopRoute },
  { pattern: ["bots", ":botId", "workspace", "file"], module: botWorkspaceFileRoute },
  { pattern: ["bots", ":botId", "workspace"], module: botWorkspaceRoute },
  { pattern: ["bots", ":botId"], module: botRoute },
  { pattern: ["bots"], module: botsRoute },
  { pattern: ["automations"], module: automationsRoute },
  { pattern: ["automations", ":automationId", "run-now"], module: automationRunNowRoute },
  { pattern: ["automations", ":automationId", "runs"], module: automationRunsRoute },
  { pattern: ["automations", ":automationId"], module: automationRoute },
  { pattern: ["automation-runs", ":runId", "retry"], module: automationRunRetryRoute },
  { pattern: ["automation-runs", ":runId"], module: automationRunRoute },
  { pattern: ["messages", ":messageId", "edit-restart"], module: messageEditRestartRoute },
  { pattern: ["messages", ":messageId", "regenerate"], module: messageRegenerateRoute },
  { pattern: ["messages", ":messageId", "retry"], module: messageRetryRoute },
  { pattern: ["messages", ":messageId", "fork"], module: messageForkRoute },
  { pattern: ["messages", ":messageId", "rewind"], module: messageRewindRoute },
  { pattern: ["messages", ":messageId"], module: messageRoute },
  { pattern: ["message-actions", ":actionId", "approve"], module: messageActionApproveRoute },
  { pattern: ["message-actions", ":actionId", "dismiss"], module: messageActionDismissRoute },
  { pattern: ["message-actions", ":actionId", "secret"], module: messageActionSecretRoute },
  { pattern: ["onboarding"], module: onboardingRoute },
  { pattern: ["settings", "general"], module: generalSettingsRoute },
  { pattern: ["settings", "semantic-recall"], module: semanticRecallSettingsRoute },
  { pattern: ["settings", "title-generation"], module: titleGenerationSettingsRoute },
  { pattern: ["settings", "providers", "duplicate"], module: providerDuplicateRoute },
  { pattern: ["settings", "providers"], module: providerSettingsRoute },
  { pattern: ["settings", "test"], module: settingsTestRoute },
  { pattern: ["settings"], module: settingsRoute },
  { pattern: ["personas"], module: personasRoute },
  { pattern: ["personas", ":personaId"], module: personaRoute },
  { pattern: ["push", "subscribe"], module: pushSubscribeRoute },
  { pattern: ["push", "vapid"], module: pushVapidRoute },
  { pattern: ["pushover"], module: pushoverRoute },
  { pattern: ["memories"], module: memoriesRoute },
  { pattern: ["memories", ":memoryId"], module: memoryRoute },
  { pattern: ["tool-approvals"], module: toolApprovalsRoute },
  { pattern: ["tool-approvals", ":ruleId"], module: toolApprovalRoute },
  { pattern: ["saved-logins"], module: savedLoginsRoute },
  { pattern: ["saved-logins", ":loginId"], module: savedLoginRoute },
  { pattern: ["mcp-servers", "test"], module: mcpServersTestRoute },
  { pattern: ["mcp-servers"], module: mcpServersRoute },
  { pattern: ["mcp-servers", ":serverId"], module: mcpServerRoute },
  { pattern: ["mcp-servers", ":serverId", "oauth"], module: mcpServerOAuthRoute },
  { pattern: ["mcp-servers", ":serverId", "oauth", "flows"], module: mcpServerOAuthFlowsRoute },
  { pattern: ["skills"], module: skillsRoute },
  { pattern: ["skills", "maintenance"], module: skillsMaintenanceRoute },
  { pattern: ["skills", "curator", "ledger"], module: skillCuratorLedgerRoute },
  { pattern: ["skills", "curator", "purge"], module: skillCuratorPurgeRoute },
  { pattern: ["skills", "curator", "rollback"], module: skillCuratorRollbackRoute },
  { pattern: ["skills", ":skillId"], module: skillRoute },
  { pattern: ["users"], module: usersRoute },
  { pattern: ["users", ":userId"], module: userRoute },
  { pattern: ["providers", ":profileId", "connection"], module: providerConnectionRoute },
  { pattern: ["providers", ":profileId", "connection", "flows"], module: providerConnectionFlowsRoute },
  { pattern: ["providers", ":profileId", "connection", "flows", ":flowId"], module: providerConnectionFlowRoute },
  { pattern: ["providers", ":profileId", "models"], module: providerModelsRoute },
  { pattern: ["speech", "transcription", "prepare"], module: speechPrepareRoute },
  { pattern: ["speech", "transcription", "transcribe"], module: speechTranscribeRoute },
  { pattern: ["speech", "transcription", "cleanup"], module: speechCleanupRoute },
  { pattern: ["whats-new"], module: whatsNewRoute }
];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export function exportedMethods(module: RouteModule) {
  return HTTP_METHODS.filter((method) => typeof module[method] === "function").map((method) =>
    method.toLowerCase()
  );
}

function patternToContractPath(pattern: string[]) {
  return `/${pattern
    .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
    .join("/")}`;
}

const mobileInlineOperations: Array<{ path: string; methods: string[] }> = [
  { path: "/conversations/{conversationId}/stop", methods: ["post"] },
  { path: "/conversations/{conversationId}/queue", methods: ["get", "post"] },
  { path: "/conversations/{conversationId}/queue/order", methods: ["put"] },
  { path: "/conversations/{conversationId}/queue/{queuedMessageId}", methods: ["patch", "delete"] },
  { path: "/conversations/{conversationId}/queue/{queuedMessageId}/send-now", methods: ["post"] }
];

export const mobileApiOperations: Array<{ path: string; methods: string[] }> = [
  ...mobileGatewayRoutes.map(({ pattern, module }) => ({
    path: patternToContractPath(pattern),
    methods: exportedMethods(module)
  })),
  ...mobileInlineOperations
];

export const mobileApiRoutePatterns = mobileGatewayRoutes.map(({ pattern }) => pattern);


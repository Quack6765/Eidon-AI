export type ApiMode = "responses" | "chat_completions";

export type ConversationRetention = "forever" | "90d" | "30d" | "7d";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type VisionMode = "none" | "native" | "mcp";

export type AutomationScheduleKind = "interval" | "calendar";

export type AutomationCalendarFrequency = "daily" | "weekly";

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "missed"
  | "stopped";

export type AutomationTriggerSource = "schedule" | "manual_run" | "manual_retry";

export type ConversationOrigin = "manual" | "automation";

export type ProviderKind = "openai_compatible" | "github_copilot";

export type GithubConnectionStatus = "disconnected" | "connected" | "expired";

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "idle" | "streaming" | "completed" | "error" | "stopped";

export type ConversationTitleGenerationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type MessageActionKind = "skill_load" | "mcp_tool_call" | "shell_command" | "create_memory" | "update_memory" | "delete_memory";

export type MessageActionStatus = "running" | "completed" | "error" | "stopped";

export type AttachmentKind = "image" | "text";

export type MemoryNodeType = "leaf_summary" | "merged_summary";

export type SystemMessageKind = "compaction_notice";

export type ProviderProfile = {
  id: string;
  providerKind: ProviderKind;
  name: string;
  apiBaseUrl: string;
  apiKeyEncrypted: string;
  model: string;
  apiMode: ApiMode;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  compactionThreshold: number;
  freshTailCount: number;
  tokenizerModel: "gpt-tokenizer" | "off";
  safetyMarginTokens: number;
  leafSourceTokenLimit: number;
  leafMinMessageCount: number;
  mergedMinNodeCount: number;
  mergedTargetTokens: number;
  visionMode: VisionMode;
  visionMcpServerId: string | null;
  githubUserAccessTokenEncrypted: string;
  githubRefreshTokenEncrypted: string;
  githubTokenExpiresAt: string | null;
  githubRefreshTokenExpiresAt: string | null;
  githubAccountLogin: string | null;
  githubAccountName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderProfileWithApiKey = ProviderProfile & {
  apiKey: string;
};

export type ProviderProfileSummary = Omit<
  ProviderProfile,
  "apiKeyEncrypted" | "githubUserAccessTokenEncrypted" | "githubRefreshTokenEncrypted"
> & {
  hasApiKey: boolean;
  githubConnectionStatus: GithubConnectionStatus;
};

export type AppSettings = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  titleGenerationStatus: ConversationTitleGenerationStatus;
  folderId: string | null;
  providerProfileId: string | null;
  automationId: string | null;
  automationRunId: string | null;
  conversationOrigin: ConversationOrigin;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
};

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  providerProfileId: string;
  personaId: string | null;
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  calendarFrequency: AutomationCalendarFrequency | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
  enabled: boolean;
  nextRunAt: string | null;
  lastScheduledFor: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: AutomationRunStatus | "paused" | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRun = {
  id: string;
  automationId: string;
  conversationId: string | null;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: AutomationRunStatus;
  errorMessage: string | null;
  triggerSource: AutomationTriggerSource;
  createdAt: string;
};

export type ConversationListPage = {
  conversations: Conversation[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type Folder = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type McpTransport = "streamable_http" | "stdio";

export type McpServer = {
  id: string;
  name: string;
  slug: string;
  url: string;
  headers: Record<string, string>;
  transport: McpTransport;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type McpToolCallResult = {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: {
      uri: string;
      text?: string;
      blob?: string;
      mimeType?: string;
    };
    uri?: string;
    name?: string;
  }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Persona = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryCategory = "personal" | "preference" | "work" | "location" | "other";

export type UserMemory = {
  id: string;
  content: string;
  category: MemoryCategory;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  thinkingContent: string;
  status: MessageStatus;
  estimatedTokens: number;
  systemKind: SystemMessageKind | null;
  compactedAt: string | null;
  createdAt: string;
  actions?: MessageAction[];
  textSegments?: MessageTextSegment[];
  timeline?: MessageTimelineItem[];
  attachments?: MessageAttachment[];
};

export type MessageAttachment = {
  id: string;
  conversationId: string;
  messageId: string | null;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  relativePath: string;
  kind: AttachmentKind;
  extractedText: string;
  createdAt: string;
};

export type MessageAction = {
  id: string;
  messageId: string;
  kind: MessageActionKind;
  status: MessageActionStatus;
  serverId: string | null;
  skillId: string | null;
  toolName: string | null;
  label: string;
  detail: string;
  arguments: Record<string, unknown> | null;
  resultSummary: string;
  sortOrder: number;
  startedAt: string;
  completedAt: string | null;
};

export type MessageTextSegment = {
  id: string;
  messageId: string;
  content: string;
  sortOrder: number;
  createdAt: string;
};

export type MessageTimelineItem =
  | {
      id: string;
      timelineKind: "text";
      sortOrder: number;
      createdAt: string;
      content: string;
    }
  | ({
      timelineKind: "action";
    } & MessageAction);

export type MemoryNode = {
  id: string;
  conversationId: string;
  type: MemoryNodeType;
  depth: number;
  content: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceTokenCount: number;
  summaryTokenCount: number;
  childNodeIds: string[];
  supersededByNodeId: string | null;
  createdAt: string;
};

export type CompactionEvent = {
  id: string;
  conversationId: string;
  nodeId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  noticeMessageId: string | null;
  createdAt: string;
};

export type AuthUser = {
  id: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

export type ChatStreamEvent =
  | { type: "message_start"; messageId: string }
  | { type: "thinking_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "action_start"; action: MessageAction }
  | { type: "action_complete"; action: MessageAction }
  | { type: "action_error"; action: MessageAction }
  | { type: "compaction_start" }
  | { type: "compaction_end" }
  | { type: "system_notice"; text: string; kind: SystemMessageKind }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
    }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export type EnsureCompactedContextResult = {
  promptMessages: PromptMessage[];
  promptTokens: number;
  didCompact: boolean;
};

export type PromptTextContentPart = {
  type: "text";
  text: string;
};

export type PromptImageContentPart = {
  type: "image";
  attachmentId: string;
  filename: string;
  mimeType: string;
  relativePath: string;
};

export type PromptContentPart = PromptTextContentPart | PromptImageContentPart;

export type PromptMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | PromptContentPart[];
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export type ProviderToolCall = {
  id: string;
  name: string;
  arguments: string;
};

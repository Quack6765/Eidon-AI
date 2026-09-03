import type {
  ExternalSttLanguage,
  ExternalSttModel
} from "@/lib/speech/external-providers";
import type { SttEngine, SttLanguage } from "@/lib/speech/types";
import type {
  TranscriptionProviderId
} from "@/lib/speech/transcription-catalog";
import type {
  ImageGenerationConfiguration,
  ImageGenerationModelId,
  ImageGenerationProviderId
} from "@/lib/image-generation/catalog";
import type { WebSearchConfiguration, WebSearchProviderId } from "@/lib/web-search-catalog";
import type {
  IntegrationSelection,
  RuntimeIntegrationSelection
} from "@/lib/integration-types";
import type {
  ApiMode,
  ProcessingMode,
  ProviderKind,
  ProviderPresetId,
  ReasoningEffort,
  VisionMode
} from "@/lib/provider-catalog";
import type {
  ProviderProfile,
  ProviderProfileSummary,
  RuntimeProviderProfile
} from "@/lib/provider-profile";

export type {
  ApiMode,
  ProcessingMode,
  ProviderKind,
  ProviderPresetId,
  ReasoningEffort,
  VisionMode
} from "@/lib/provider-catalog";
export type {
  ProviderConnectionStatus,
  ProviderProfile,
  ProviderProfileCore,
  ProviderProfileSummary,
  RuntimeProviderProfile
} from "@/lib/provider-profile";

export type ConversationRetention = "forever" | "90d" | "30d" | "7d";

export type { SttEngine, SttLanguage } from "@/lib/speech/types";
export type { WebSearchProviderId } from "@/lib/web-search-catalog";
export type {
  ImageGenerationModelId,
  ImageGenerationProviderId
} from "@/lib/image-generation/catalog";
export type { TranscriptionProviderId } from "@/lib/speech/transcription-catalog";

export type ChatInputMode = "chat" | "image";

export type UserRole = "admin" | "user";

export type AuthSource = "env_super_admin" | "local";

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

export type ConversationOrigin = "manual" | "automation" | "bot";

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "idle" | "streaming" | "completed" | "error" | "stopped";

export type QueuedMessageStatus = "pending" | "processing" | "failed" | "cancelled";

export type ConversationTitleGenerationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type MessageActionKind = "skill_load" | "save_skill" | "mcp_tool_call" | "shell_command" | "create_memory" | "update_memory" | "delete_memory" | "image_generation" | "delegate_task" | "message_bot" | "create_bot" | "update_bot" | "create_automation";

export type MessageActionStatus = "running" | "pending" | "completed" | "error" | "stopped";

export type MessageThinkingStatus = "running" | "completed" | "error" | "stopped";

export type AttachmentKind = "image" | "text" | "file";

export type MemoryNodeType = "leaf_summary" | "merged_summary";

export type SystemMessageKind = "compaction_notice";

export type TitleGenerationMode = "same" | "specific" | "local";

export type ToolCallDisplayMode = "pills" | "status_line";

export type DefaultView = "chat" | "agents" | "automations";

type AppSettingsCore = {
  defaultProviderProfileId: string | null;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  memoriesRigor: MemoryRigor;
  semanticRecallEnabled: boolean;
  mcpTimeout: number;
  maxAssistantToolSteps: number;
  confirmExternalLinks: boolean;
  toolCallDisplay: ToolCallDisplayMode;
  defaultView: DefaultView;
  titleGenerationMode: TitleGenerationMode;
  titleGenerationProfileId: string | null;
  speechCleanupEnabled: boolean;
  speechCleanupProfileId: string | null;
  speechCleanupPrompt: string;
  botSystemPrompt: string;
  updatedAt: string;
};

export type AppSettings = AppSettingsCore & {
  webSearch: IntegrationSelection<WebSearchProviderId, WebSearchConfiguration>;
  imageGeneration: IntegrationSelection<ImageGenerationProviderId, ImageGenerationConfiguration>;
  speechTranscription: IntegrationSelection<TranscriptionProviderId, {
    language: SttLanguage | ExternalSttLanguage;
    model?: ExternalSttModel;
  }>;
};

export type RuntimeAppSettings = AppSettingsCore & {
  webSearch: RuntimeIntegrationSelection<WebSearchProviderId, WebSearchConfiguration>;
  imageGeneration: RuntimeIntegrationSelection<
    ImageGenerationProviderId,
    ImageGenerationConfiguration
  >;
  speechTranscription: RuntimeIntegrationSelection<
    TranscriptionProviderId,
    { language: SttLanguage | ExternalSttLanguage; model?: ExternalSttModel }
  >;
};

export type BotRunTriggerSource = "dm" | "delegated" | "routine";

export type BotRunStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export type Bot = {
  id: string;
  userId: string | null;
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  systemPrompt: string;
  isChief: boolean;
  homeConversationId: string;
  createdAt: string;
  updatedAt: string;
};

export type BotRun = {
  id: string;
  botId: string;
  conversationId: string;
  triggerSource: BotRunTriggerSource;
  status: BotRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  parentMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type BotStatus = "idle" | "queued" | "running";

export type BotSummary = {
  id: string;
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  isChief: boolean;
  homeConversationId: string;
  status: BotStatus;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  titleGenerationStatus: ConversationTitleGenerationStatus;
  folderId: string | null;
  providerProfileId: string | null;
  reasoningEffort: ReasoningEffort | null;
  automationId: string | null;
  automationRunId: string | null;
  conversationOrigin: ConversationOrigin;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  shareEnabled: boolean;
  shareToken: string | null;
  sharedAt: string | null;
  isTemporary: boolean;
};

export type ConversationSearchResult = Conversation & {
  matchSnippet?: string;
};

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  providerProfileId: string;
  personaId: string | null;
  botId: string | null;
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  calendarFrequency: AutomationCalendarFrequency | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
  continuePreviousConversation: boolean;
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

export type QueuedMessage = {
  id: string;
  conversationId: string;
  content: string;
  status: QueuedMessageStatus;
  sortOrder: number;
  failureMessage: string | null;
  mode: ChatInputMode;
  createdAt: string;
  updatedAt: string;
  processingStartedAt: string | null;
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
  isVisionMcp: boolean;
  createdAt: string;
  updatedAt: string;
};

export type McpOAuthStatus = "connected" | "expired" | "auth_required";

export type McpServerOAuthSummary = {
  status: McpOAuthStatus;
  expiresAt: string | null;
  scope: string | null;
};

export type McpServerSummary = Omit<McpServer, "headers" | "env"> & {
  headers: Record<string, never>;
  env: null;
  hasHeaders: boolean;
  hasEnv: boolean;
  oauth: McpServerOAuthSummary | null;
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

export type MemoryRigor = "low" | "balanced" | "high";

export type MemoryProposalOperation = "create" | "update" | "delete";
export type MemoryProposalState = "pending" | "approved" | "dismissed" | "superseded";

export type MemoryProposalPayload = {
  operation: MemoryProposalOperation;
  targetMemoryId: string | null;
  botId?: string | null;
  currentMemory?: {
    id: string;
    content: string;
    category: MemoryCategory;
  };
  proposedMemory?: {
    content: string;
    category: MemoryCategory;
  };
};

export type AutomationProposalPayload = {
  name: string;
  prompt: string;
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  calendarFrequency: AutomationCalendarFrequency | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
  providerProfileId: string;
  personaId: string | null;
  continuePreviousConversation: boolean;
  automationId?: string | null;
};

export type ProposalPayload = MemoryProposalPayload | AutomationProposalPayload;

export type UserMemory = {
  id: string;
  content: string;
  category: MemoryCategory;
  pinned: boolean;
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

export type ConversationSnapshot = {
  conversation: Conversation;
  messages: Message[];
  queuedMessages: QueuedMessage[];
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
  proposalState: MemoryProposalState | null;
  proposalPayload: ProposalPayload | null;
  proposalUpdatedAt: string | null;
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
  | {
      id: string;
      messageId: string;
      timelineKind: "thinking";
      status: MessageThinkingStatus;
      sortOrder: number;
      startOffset: number;
      endOffset: number | null;
      startedAt: string;
      completedAt: string | null;
    }
  | ({
      timelineKind: "action";
    } & MessageAction);

export type PublicConversationSummary = Pick<
  Conversation,
  "id" | "title" | "createdAt" | "updatedAt"
>;

export type PublicMessageAttachment = Pick<
  MessageAttachment,
  "id" | "filename" | "mimeType" | "kind" | "byteSize" | "createdAt"
>;

export type PublicMessageTextSegment = Pick<
  MessageTextSegment,
  "id" | "content" | "sortOrder" | "createdAt"
>;

export type PublicMessage = Pick<
  Message,
  "id" | "role" | "content" | "status" | "createdAt"
> & {
  thinkingContent?: Message["thinkingContent"];
  actions?: Message["actions"];
  timeline?: Message["timeline"];
  textSegments?: PublicMessageTextSegment[];
  attachments?: PublicMessageAttachment[];
};

export type PublicConversationView = {
  conversation: PublicConversationSummary;
  messages: PublicMessage[];
};

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

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  authSource: AuthSource;
  passwordManagedBy: "env" | "local";
  createdAt: string;
  updatedAt: string;
};

export type PersistedUser = {
  id: string;
  username: string;
  role: UserRole;
  authSource: AuthSource;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

export type MobileSession = AuthSession & {
  deviceName: string;
};

export type ChatStreamEvent =
  | { type: "message_start"; messageId: string }
  | { type: "thinking_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "answer_reset" }
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
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
    }
  | {
      type: "context_usage";
      contextTokens: number;
      compactionLimit: number;
      memoriesUsed?: number;
      memoriesTotal?: number;
    }
  | { type: "stream_retry"; attempt: number }
  | { type: "done"; messageId: string; message?: Message }
  | { type: "error"; message: string };

export type EnsureCompactedContextResult = {
  promptMessages: PromptMessage[];
  promptTokens: number;
  didCompact: boolean;
  memoriesUsed?: number;
  memoriesTotal?: number;
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

export type ProviderResponseItem = {
  type: string;
  [key: string]: unknown;
};

export type PromptMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | PromptContentPart[];
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
  responseItems?: ProviderResponseItem[];
  reasoningContent?: string;
  reasoningSignature?: string;
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

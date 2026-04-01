export type ApiMode = "responses" | "chat_completions";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "idle" | "streaming" | "completed" | "error";

export type ToolExecutionMode = "read_only" | "read_write";

export type ConversationTitleGenerationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type MessageActionKind = "skill_load" | "mcp_tool_call" | "shell_command";

export type MessageActionStatus = "running" | "completed" | "error";

export type AttachmentKind = "image" | "text";

export type MemoryNodeType = "leaf_summary" | "merged_summary";

export type SystemMessageKind = "compaction_notice";

export type ProviderProfile = {
  id: string;
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
  createdAt: string;
  updatedAt: string;
};

export type ProviderProfileWithApiKey = ProviderProfile & {
  apiKey: string;
};

export type ProviderProfileSummary = Omit<ProviderProfile, "apiKeyEncrypted"> & {
  hasApiKey: boolean;
};

export type AppSettings = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  titleGenerationStatus: ConversationTitleGenerationStatus;
  folderId: string | null;
  providerProfileId: string | null;
  toolExecutionMode: ToolExecutionMode;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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
  noticeMessageId: string;
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
  | { type: "answer_commit"; text: string }
  | { type: "action_start"; action: MessageAction }
  | { type: "action_complete"; action: MessageAction }
  | { type: "action_error"; action: MessageAction }
  | { type: "system_notice"; text: string; kind: SystemMessageKind }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
    }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export type SummaryPayload = {
  factualCommitments: string[];
  userPreferences: string[];
  unresolvedItems: string[];
  importantReferences: string[];
  chronology: string[];
  sourceSpan: {
    startMessageId: string;
    endMessageId: string;
    messageCount: number;
  };
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
  role: "system" | "user" | "assistant";
  content: string | PromptContentPart[];
};

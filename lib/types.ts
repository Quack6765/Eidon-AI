export type ApiMode = "responses" | "chat_completions";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "idle" | "streaming" | "completed" | "error";

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

export type AppSettings = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  folderId: string | null;
  providerProfileId: string | null;
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

export type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

import type { RuntimeToolContext } from "@/lib/runtime-tool-context";
import type {
  ChatStreamEvent,
  AuthUser,
  PromptMessage,
  ProviderProfile,
  ProviderResponseItem,
  RuntimeProviderProfile,
  ProviderToolCall,
  ToolDefinition
} from "@/lib/types";

export type ProviderTextPurpose =
  | "compaction"
  | "test"
  | "title"
  | "image_instruction"
  | "web_search_planning"
  | "speech_cleanup";

export type ProviderTextInput = {
  settings: RuntimeProviderProfile;
  prompt: string;
  purpose: ProviderTextPurpose;
  conversationId?: string;
  abortSignal?: AbortSignal;
};

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

export type ProviderStreamResult = {
  answer: string;
  thinking: string;
  toolCalls?: ProviderToolCall[];
  responseItems?: ProviderResponseItem[];
  reasoningSignature?: string;
  usage: ProviderUsage;
};

export type ProviderStreamInput = {
  settings: RuntimeProviderProfile;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  runtimeToolContext?: RuntimeToolContext;
};

export type ProviderAdapter = {
  getReadinessError(profile: RuntimeProviderProfile): string | null;
  supportsStreamRetry: boolean;
  callText(input: ProviderTextInput): Promise<string>;
  stream(
    input: ProviderStreamInput
  ): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void>;
  discoverModels(profile: RuntimeProviderProfile): Promise<Array<{
    id: string;
    name: string;
    maxContextWindowTokens: number | null;
  }>>;
  connectionFlows?: {
    create(
      user: AuthUser,
      profileId: string,
      input?: { client?: "native" | "browser" }
    ): Promise<unknown>;
    get(flowId: string, userId: string): { profileId: string } | null;
    cancel(flowId: string, userId: string): boolean;
  };
};

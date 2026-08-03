import type { CopilotToolContext } from "@/lib/copilot-tools";
import type {
  ChatStreamEvent,
  AuthUser,
  PromptMessage,
  ProviderProfile,
  ProviderProfileWithApiKey,
  ProviderToolCall,
  ToolDefinition
} from "@/lib/types";

export type ProviderTextPurpose = "compaction" | "test" | "title" | "image_instruction";

export type ProviderTextInput = {
  settings: ProviderProfileWithApiKey;
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
  reasoningSignature?: string;
  usage: ProviderUsage;
};

export type ProviderStreamInput = {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  runtimeToolContext?: CopilotToolContext;
};

export type ProviderAdapter = {
  getReadinessError(profile: ProviderProfileWithApiKey): string | null;
  supportsStreamRetry: boolean;
  callText(input: ProviderTextInput): Promise<string>;
  stream(
    input: ProviderStreamInput
  ): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void>;
  discoverModels(profile: ProviderProfileWithApiKey): Promise<Array<{
    id: string;
    name: string;
    maxContextWindowTokens: number | null;
  }>>;
  connectionFlows?: {
    create(user: AuthUser, profileId: string): Promise<unknown>;
    get(flowId: string, userId: string): { profileId: string } | null;
    cancel(flowId: string, userId: string): boolean;
  };
};

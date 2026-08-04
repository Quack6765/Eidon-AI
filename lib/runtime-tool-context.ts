import type { ToolSet } from "@/lib/tool-definitions";
import type { RuntimeAction } from "@/lib/tool-executors";
import type {
  PromptMessage,
  RuntimeAppSettings,
  RuntimeProviderProfile,
  Skill,
  VisionMode
} from "@/lib/types";

export type RuntimeToolContext = {
  settings?: RuntimeProviderProfile;
  appSettings?: RuntimeAppSettings;
  conversationId?: string;
  assistantMessageId?: string;
  promptMessages?: PromptMessage[];
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  memoriesEnabled: boolean;
  effectiveVisionMode: VisionMode;
  memoryUserId?: string;
  imageGenerationToolEnabled?: boolean;
  restrictToGenerateImage?: boolean;
  imageGenerationActionHandle?: string;
  hasVisibleImageGenerationAction?: boolean;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onActionComplete?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
  onActionError?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
  mcpTimeout?: number;
  abortSignal?: AbortSignal;
};

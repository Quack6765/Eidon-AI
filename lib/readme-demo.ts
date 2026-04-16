import { attachConversationToRun, createAutomation, createAutomationRun, updateAutomationRunStatus } from "@/lib/automations";
import {
  createConversation,
  createMessage,
  createMessageAction,
  createMessageTextSegment,
  createQueuedMessage,
  setConversationActive,
  updateMessageAction
} from "@/lib/conversations";
import { createFolder } from "@/lib/folders";
import { createMcpServer, deleteMcpServer, listMcpServers } from "@/lib/mcp-servers";
import { createMemory } from "@/lib/memories";
import { createPersona } from "@/lib/personas";
import { getSettingsDefaults, updateGeneralSettingsForUser, updateSettings } from "@/lib/settings";
import { createSkill, listSkills, updateSkill } from "@/lib/skills";
import {
  createLocalUser,
  deleteManagedUser,
  ensureEnvSuperAdminUser,
  findPersistedUserByUsername
} from "@/lib/users";

const DEMO_PASSWORD = "ReadmeDemo123!";

function nowIso() {
  return new Date().toISOString();
}

function buildProviderProfile(
  overrides: Partial<{
    id: string;
    name: string;
    providerKind: "openai_compatible" | "github_copilot";
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    apiMode: "responses" | "chat_completions";
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
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
    visionMode: "none" | "native" | "mcp";
    visionMcpServerId: string | null;
    providerPresetId: "ollama_cloud" | "glm_coding_plan" | "openrouter" | "custom_openai_compatible" | null;
    githubUserAccessTokenEncrypted: string;
    githubRefreshTokenEncrypted: string;
    githubTokenExpiresAt: string | null;
    githubRefreshTokenExpiresAt: string | null;
    githubAccountLogin: string | null;
    githubAccountName: string | null;
  }>
) {
  const defaults = getSettingsDefaults();

  return {
    id: overrides.id ?? "readme_profile_default",
    name: overrides.name ?? defaults.name,
    providerKind: overrides.providerKind ?? "openai_compatible",
    apiBaseUrl: overrides.apiBaseUrl ?? defaults.apiBaseUrl,
    apiKey: overrides.apiKey ?? "",
    model: overrides.model ?? defaults.model,
    apiMode: overrides.apiMode ?? defaults.apiMode,
    systemPrompt: overrides.systemPrompt ?? defaults.systemPrompt,
    temperature: overrides.temperature ?? defaults.temperature,
    maxOutputTokens: overrides.maxOutputTokens ?? defaults.maxOutputTokens,
    reasoningEffort: overrides.reasoningEffort ?? defaults.reasoningEffort,
    reasoningSummaryEnabled:
      overrides.reasoningSummaryEnabled ?? defaults.reasoningSummaryEnabled,
    modelContextLimit: overrides.modelContextLimit ?? defaults.modelContextLimit,
    compactionThreshold: overrides.compactionThreshold ?? defaults.compactionThreshold,
    freshTailCount: overrides.freshTailCount ?? defaults.freshTailCount,
    tokenizerModel: overrides.tokenizerModel ?? defaults.tokenizerModel,
    safetyMarginTokens: overrides.safetyMarginTokens ?? defaults.safetyMarginTokens,
    leafSourceTokenLimit:
      overrides.leafSourceTokenLimit ?? defaults.leafSourceTokenLimit,
    leafMinMessageCount:
      overrides.leafMinMessageCount ?? defaults.leafMinMessageCount,
    mergedMinNodeCount:
      overrides.mergedMinNodeCount ?? defaults.mergedMinNodeCount,
    mergedTargetTokens:
      overrides.mergedTargetTokens ?? defaults.mergedTargetTokens,
    visionMode: overrides.visionMode ?? defaults.visionMode,
    visionMcpServerId: overrides.visionMcpServerId ?? defaults.visionMcpServerId,
    providerPresetId: overrides.providerPresetId ?? null,
    githubUserAccessTokenEncrypted:
      overrides.githubUserAccessTokenEncrypted ?? "",
    githubRefreshTokenEncrypted:
      overrides.githubRefreshTokenEncrypted ?? "",
    githubTokenExpiresAt: overrides.githubTokenExpiresAt ?? null,
    githubRefreshTokenExpiresAt:
      overrides.githubRefreshTokenExpiresAt ?? null,
    githubAccountLogin: overrides.githubAccountLogin ?? null,
    githubAccountName: overrides.githubAccountName ?? null
  };
}

export const README_DEMO_FIXTURES = {
  localAdmin: {
    username: "readme_admin",
    password: DEMO_PASSWORD,
    role: "admin" as const
  },
  member: {
    username: "readme_member",
    password: DEMO_PASSWORD,
    role: "user" as const
  },
  providerProfiles: [
    buildProviderProfile({
      id: "readme_profile_openai",
      name: "OpenAI · GPT-5",
      apiBaseUrl: "https://api.openai.com/v1",
      apiKey: "sk-readme-openai",
      model: "gpt-5",
      systemPrompt:
        "Help a self-hosted engineering team ship changes with precise summaries and practical next steps.",
      providerPresetId: "custom_openai_compatible"
    }),
    buildProviderProfile({
      id: "readme_profile_openrouter",
      name: "OpenRouter · Claude Sonnet 4",
      apiBaseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-readme-openrouter",
      model: "anthropic/claude-sonnet-4",
      providerPresetId: "openrouter",
      temperature: 0.3
    }),
    buildProviderProfile({
      id: "readme_profile_ollama",
      name: "Local Ollama · Qwen3",
      apiBaseUrl: "https://ollama.example.internal/v1",
      apiKey: "sk-readme-ollama",
      model: "qwen3:32b",
      providerPresetId: "ollama_cloud",
      maxOutputTokens: 900
    }),
    buildProviderProfile({
      id: "readme_profile_copilot",
      name: "GitHub Copilot",
      providerKind: "github_copilot",
      apiBaseUrl: "https://api.githubcopilot.com",
      apiKey: "",
      model: "gpt-4.1",
      systemPrompt:
        "Act like a high-signal coding assistant that stays concise and production-minded.",
      providerPresetId: null
    })
  ],
  personas: [
    {
      name: "Release Captain",
      content:
        "Focus on launch readiness, risk triage, rollback plans, and crisp ownership handoffs."
    },
    {
      name: "Docs Shiproom",
      content:
        "Write operator-facing docs that are short, accurate, and biased toward self-hosting clarity."
    }
  ],
  skills: [
    {
      name: "Release Radar",
      description: "Tracks blockers across launch docs, automation output, and issue queues.",
      content: `---
name: Release Radar
description: Tracks blockers across launch docs, automation output, and issue queues.
---

# Release Radar

When asked about a release, summarize blockers, owners, rollback risks, and missing evidence.
Prefer concise bullet points and call out anything that would slow a self-hosted operator down.`
    },
    {
      name: "README Distiller",
      description: "Turns product internals into short, convincing self-hosting copy.",
      content: `---
name: README Distiller
description: Turns product internals into short, convincing self-hosting copy.
---

# README Distiller

Rewrite implementation details into buyer-facing README copy.
Lead with product value, keep claims accurate, and make install steps feel easy.`
    }
  ],
  mcpServers: [
    {
      name: "Linear Cloud",
      transport: "streamable_http" as const,
      url: "https://mcp.linear.app/sse",
      headers: {
        Authorization: "Bearer readme-linear-token"
      }
    },
    {
      name: "npm Docs",
      transport: "stdio" as const,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    {
      name: "uvx Search",
      transport: "stdio" as const,
      command: "uvx",
      args: ["--from", "mcp-server-fetch", "mcp-server-fetch"]
    }
  ],
  memories: [
    {
      category: "work" as const,
      content: "The public launch needs a feature-led README and proof screenshots before release."
    },
    {
      category: "preference" as const,
      content: "Prefer short summaries with explicit owners, dates, and rollback notes."
    },
    {
      category: "personal" as const,
      content: "Comfortable approving infra changes once Docker and restore steps are documented."
    },
    {
      category: "location" as const,
      content: "Primary overlap is Toronto mornings and Abuja afternoons."
    },
    {
      category: "other" as const,
      content: "Keep image generation labeled as coming at launch until it lands on main."
    }
  ],
  folders: ["Launch Ops", "Playbooks"],
  primaryConversationTitle: "April launch control room",
  secondaryConversationTitle: "Provider fallback matrix",
  automationConversationTitle: "Nightly launch scan · Apr 14",
  automation: {
    name: "Nightly launch watch",
    prompt:
      "Review launch docs, provider health, and screenshot coverage. Summarize only the blockers and missing proof.",
    timeOfDay: "23:15"
  }
} as const;

export type ReadmeDemoSeedResult = {
  localAdminId: string;
  memberId: string;
  primaryConversationId: string;
  secondaryConversationId: string;
  automationConversationId: string;
  automationId: string;
};

async function deleteDemoUsers() {
  for (const username of [
    README_DEMO_FIXTURES.localAdmin.username,
    README_DEMO_FIXTURES.member.username
  ]) {
    const record = findPersistedUserByUsername(username);

    if (record?.user.authSource === "local") {
      deleteManagedUser(record.user.id);
    }
  }
}

function resetDemoSkills() {
  const existingSkills = listSkills();

  for (const fixture of README_DEMO_FIXTURES.skills) {
    const existing = existingSkills.find((skill) => skill.name === fixture.name);

    if (!existing) {
      createSkill(fixture);
      continue;
    }

    updateSkill(existing.id, {
      name: fixture.name,
      description: fixture.description,
      content: fixture.content,
      enabled: true
    });
  }
}

function resetDemoMcpServers() {
  for (const existing of listMcpServers()) {
    if (
      README_DEMO_FIXTURES.mcpServers.some(
        (fixture) => fixture.name === existing.name
      )
    ) {
      deleteMcpServer(existing.id);
    }
  }

  for (const fixture of README_DEMO_FIXTURES.mcpServers) {
    createMcpServer(fixture);
  }
}

function markCompletedAction(actionId: string) {
  updateMessageAction(actionId, {
    status: "completed",
    completedAt: nowIso()
  });
}

export async function seedReadmeDemoData(): Promise<ReadmeDemoSeedResult> {
  await ensureEnvSuperAdminUser();
  await deleteDemoUsers();

  updateSettings({
    defaultProviderProfileId: README_DEMO_FIXTURES.providerProfiles[1].id,
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 120,
    mcpTimeout: 120_000,
    providerProfiles: README_DEMO_FIXTURES.providerProfiles
  });

  resetDemoSkills();
  resetDemoMcpServers();

  const localAdmin = await createLocalUser(README_DEMO_FIXTURES.localAdmin);
  const member = await createLocalUser(README_DEMO_FIXTURES.member);

  updateGeneralSettingsForUser(localAdmin.id, {
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 120,
    mcpTimeout: 120_000,
    sttEngine: "browser",
    sttLanguage: "en",
    webSearchEngine: "exa"
  });

  updateGeneralSettingsForUser(member.id, {
    conversationRetention: "30d",
    memoriesEnabled: true,
    memoriesMaxCount: 60,
    sttEngine: "browser",
    sttLanguage: "en",
    webSearchEngine: "disabled"
  });

  const personas = README_DEMO_FIXTURES.personas.map((persona) =>
    createPersona(persona, localAdmin.id)
  );

  README_DEMO_FIXTURES.memories.forEach((memory) =>
    createMemory(memory.content, memory.category, localAdmin.id)
  );

  const launchOpsFolder = createFolder(README_DEMO_FIXTURES.folders[0], localAdmin.id);
  const playbooksFolder = createFolder(README_DEMO_FIXTURES.folders[1], localAdmin.id);

  const primaryConversation = createConversation(
    README_DEMO_FIXTURES.primaryConversationTitle,
    launchOpsFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    localAdmin.id
  );
  setConversationActive(primaryConversation.id, true);

  createMessage({
    conversationId: primaryConversation.id,
    role: "user",
    content:
      "Audit the self-hosted launch plan. I need a short readiness summary, the biggest proof gaps, and what still blocks a clean README publish."
  });

  const assistantReply = createMessage({
    conversationId: primaryConversation.id,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: assistantReply.id,
    sortOrder: 0,
    content:
      "Readiness looks strong: Docker onboarding, provider routing, and multi-user administration already read like a product."
  });

  const releaseSkill = listSkills().find(
    (skill) => skill.name === README_DEMO_FIXTURES.skills[0].name
  );
  const linearServer = listMcpServers().find(
    (server) => server.name === README_DEMO_FIXTURES.mcpServers[0].name
  );

  const skillAction = createMessageAction({
    messageId: assistantReply.id,
    kind: "skill_load",
    status: "completed",
    skillId: releaseSkill?.id ?? null,
    label: "Loaded Release Radar",
    detail: "Reused the launch-ops checklist skill to structure the summary.",
    resultSummary: "Release checklist loaded",
    sortOrder: 1
  });
  markCompletedAction(skillAction.id);

  createMessageTextSegment({
    messageId: assistantReply.id,
    sortOrder: 2,
    content:
      "The missing proof is visual: one mobile settings shot and one automation run view would close most reviewer questions."
  });

  const linearAction = createMessageAction({
    messageId: assistantReply.id,
    kind: "mcp_tool_call",
    status: "completed",
    serverId: linearServer?.id ?? null,
    toolName: "search_issues",
    label: "Linear Cloud.search_issues",
    detail: "Checked open launch blockers tagged docs, release, and onboarding.",
    arguments: {
      query: "docs OR onboarding OR release",
      limit: 5
    },
    resultSummary: "3 active blockers remain",
    sortOrder: 3
  });
  markCompletedAction(linearAction.id);

  createMessageTextSegment({
    messageId: assistantReply.id,
    sortOrder: 4,
    content:
      "I also recommend scheduling a nightly launch watch so README drift and screenshot coverage are reviewed automatically."
  });

  const memoryAction = createMessageAction({
    messageId: assistantReply.id,
    kind: "create_memory",
    status: "completed",
    label: "Saved launch preference",
    detail: "Stored the rule to keep future-launch features explicitly labeled in docs.",
    resultSummary: "Preference captured for future launches",
    sortOrder: 5
  });
  markCompletedAction(memoryAction.id);

  createQueuedMessage({
    conversationId: primaryConversation.id,
    content: "Turn the launch watch recommendation into a recurring automation."
  });
  createQueuedMessage({
    conversationId: primaryConversation.id,
    content: "Draft a tighter README hero paragraph for self-hosters."
  });

  const secondaryConversation = createConversation(
    README_DEMO_FIXTURES.secondaryConversationTitle,
    playbooksFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[2].id
    },
    localAdmin.id
  );
  createMessage({
    conversationId: secondaryConversation.id,
    role: "user",
    content:
      "Map our provider fallback order if OpenAI is rate-limited during launch week."
  });
  createMessage({
    conversationId: secondaryConversation.id,
    role: "assistant",
    content:
      "Fallback order: OpenAI GPT-5 for primary responses, OpenRouter Claude Sonnet 4 for long-form reasoning, Local Ollama Qwen3 for internal-only workflows, and GitHub Copilot for coding-heavy tasks."
  });

  const automation = createAutomation(
    {
      name: README_DEMO_FIXTURES.automation.name,
      prompt: README_DEMO_FIXTURES.automation.prompt,
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[0].id,
      personaId: personas[0]?.id ?? null,
      scheduleKind: "calendar",
      intervalMinutes: null,
      calendarFrequency: "daily",
      timeOfDay: README_DEMO_FIXTURES.automation.timeOfDay,
      daysOfWeek: []
    },
    localAdmin.id
  );

  const completedRun = createAutomationRun({
    automationId: automation.id,
    scheduledFor: "2026-04-14T09:15:00.000Z",
    triggerSource: "schedule"
  });

  updateAutomationRunStatus(completedRun.id, {
    status: "running",
    startedAt: "2026-04-14T09:15:06.000Z"
  });

  const automationConversation = createConversation(
    README_DEMO_FIXTURES.automationConversationTitle,
    launchOpsFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[0].id,
      origin: "automation",
      automationId: automation.id,
      automationRunId: completedRun.id
    },
    localAdmin.id
  );
  attachConversationToRun(completedRun.id, automationConversation.id);

  createMessage({
    conversationId: automationConversation.id,
    role: "user",
    content: README_DEMO_FIXTURES.automation.prompt
  });
  createMessage({
    conversationId: automationConversation.id,
    role: "assistant",
    content:
      "Nightly check complete. Docker install copy is strong, provider screenshots are ready, and the only missing artifact is a mobile providers screen with admin controls visible."
  });

  updateAutomationRunStatus(completedRun.id, {
    status: "completed",
    startedAt: "2026-04-14T09:15:06.000Z",
    finishedAt: "2026-04-14T09:16:42.000Z"
  });

  return {
    localAdminId: localAdmin.id,
    memberId: member.id,
    primaryConversationId: primaryConversation.id,
    secondaryConversationId: secondaryConversation.id,
    automationConversationId: automationConversation.id,
    automationId: automation.id
  };
}

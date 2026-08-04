import { attachConversationToRun, createAutomation, createAutomationRun, deleteAutomation, listAutomations, updateAutomationRunStatus } from "@/lib/automations";
import {
  createConversation,
  createMessage,
  createMessageAction,
  createMessageTextSegment,
  createQueuedMessage,
  deleteConversation,
  listConversations,
  setConversationActive,
  updateMessageAction
} from "@/lib/conversations";
import { createFolder, deleteFolder, listFolders } from "@/lib/folders";
import { createMcpServer, deleteMcpServer, listMcpServers } from "@/lib/mcp-servers";
import { createMemory, deleteMemory, listMemories } from "@/lib/memories";
import { createPersona, deletePersona, listPersonas } from "@/lib/personas";
import { createProviderProfileDraft, type ProviderKind, type ProviderPresetId } from "@/lib/provider-catalog";
import { updateIntegrationSetting } from "@/lib/integration-settings";
import { updateGeneralSettingsForUser, updateProviderCatalog } from "@/lib/settings";
import { createSkill, listSkills, updateSkill } from "@/lib/skills";
import {
  createLocalUser,
  deleteManagedUser,
  ensureEnvSuperAdminUser,
  findPersistedUserByUsername
} from "@/lib/users";
import { nowIso } from "@/lib/utils";

const DEMO_PASSWORD = "ReadmeDemo123!";


function buildProviderProfile(
  overrides: Partial<{
    id: string;
    name: string;
    providerKind: ProviderKind;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    apiMode: "responses" | "chat_completions";
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
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
    providerPresetId: ProviderPresetId | null;
  }>
) {
  const providerKind = overrides.providerKind ?? "openai_compatible";
  const defaults = createProviderProfileDraft({ providerKind });
  const apiBaseUrl = overrides.apiBaseUrl ?? defaults.apiBaseUrl;
  const apiMode = overrides.apiMode ?? defaults.apiMode;

  return {
    id: overrides.id ?? "readme_profile_default",
    name: overrides.name ?? defaults.name,
    providerKind,
    providerConfig: providerKind === "github_copilot"
      ? {}
      : providerKind === "anthropic"
        ? { apiBaseUrl }
        : {
            apiBaseUrl,
            apiMode,
            processingMode: defaults.processingMode,
            reasoningParameterMode: defaults.reasoningParameterMode
          },
    credential: overrides.apiKey ?? "",
    credentialAction: overrides.apiKey ? "replace" as const : "clear" as const,
    model: overrides.model ?? defaults.model,
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
    providerPresetId: overrides.providerPresetId ?? null
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
      providerPresetId: "openai_official"
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
  webSearchConversationTitle: "Self-hosting an LLM stack",
  visualsConversationTitle: "Designing a deploy pipeline",
  visualsCodeConversationTitle: "Rate limiter helper",
  visualsMermaidConversationTitle: "Request lifecycle diagram",
  memoriesConversationTitle: "Onboarding preferences · saved",
  automation: {
    name: "Nightly launch watch",
    prompt:
      "Review launch docs, provider health, and screenshot coverage. Summarize only the blockers and missing proof.",
    timeOfDay: "23:15"
  },
  extraAutomations: [
    {
      name: "Morning brief · blockers",
      prompt:
        "Scan open issues, PRs, and deploy logs. Send a short morning brief naming the top 3 blockers and their owners.",
      scheduleKind: "calendar" as const,
      calendarFrequency: "daily" as const,
      timeOfDay: "08:30",
      enabled: true
    },
    {
      name: "Weekly README drift check",
      prompt:
        "Compare the live README against the current product. Flag anything stale, missing, or contradicted by recent releases.",
      scheduleKind: "calendar" as const,
      calendarFrequency: "weekly" as const,
      timeOfDay: "09:00",
      daysOfWeek: [1],
      enabled: true
    },
    {
      name: "Provider health poll",
      prompt:
        "Ping every configured provider and report latency + error rate. Alert if any provider exceeds 5% errors.",
      scheduleKind: "interval" as const,
      intervalMinutes: 30,
      enabled: true
    },
    {
      name: "Screenshot coverage audit",
      prompt:
        "List every product feature and check whether a current screenshot exists. Report missing or outdated captures.",
      scheduleKind: "calendar" as const,
      calendarFrequency: "daily" as const,
      timeOfDay: "18:45",
      enabled: false
    },
    {
      name: "Memory tidy-up",
      prompt:
        "Review stored memories, dedupe overlapping entries, and archive anything older than 60 days that is no longer referenced.",
      scheduleKind: "interval" as const,
      intervalMinutes: 360,
      enabled: false
    }
  ]
};

export type ReadmeDemoSeedResult = {
  envSuperAdminId: string;
  localAdminId: string;
  memberId: string;
  primaryConversationId: string;
  secondaryConversationId: string;
  automationConversationId: string;
  automationId: string;
  automationRunId: string;
  webSearchConversationId: string;
  visualsConversationId: string;
  visualsCodeConversationId: string;
  visualsMermaidConversationId: string;
  memoriesConversationId: string;
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

function deleteDemoAdminResources(userId: string) {
  for (const automation of listAutomations(userId)) {
    deleteAutomation(automation.id, userId);
  }
  for (const conversation of listConversations(userId)) {
    deleteConversation(conversation.id, userId);
  }
  for (const folder of listFolders(userId)) {
    deleteFolder(folder.id, userId);
  }
  for (const memory of listMemories(userId)) {
    deleteMemory(memory.id, userId);
  }
  for (const persona of listPersonas(userId)) {
    deletePersona(persona.id, userId);
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
    const mcpFixture = fixture as {
      name: string;
      transport?: "streamable_http" | "stdio";
      url?: string;
      headers?: Record<string, string>;
      command?: string;
      args?: readonly string[];
      env?: Record<string, string>;
    };
    createMcpServer({
      ...mcpFixture,
      args: mcpFixture.args ? [...mcpFixture.args] : undefined
    });
  }
}

function markCompletedAction(actionId: string) {
  updateMessageAction(actionId, {
    status: "completed",
    completedAt: nowIso()
  });
}

export async function seedReadmeDemoData(): Promise<ReadmeDemoSeedResult> {
  const envSuperAdmin = await ensureEnvSuperAdminUser();
  await deleteDemoUsers();
  deleteDemoAdminResources(envSuperAdmin.id);

  updateProviderCatalog({
    defaultProviderProfileId: README_DEMO_FIXTURES.providerProfiles[1].id,
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 120,
    mcpTimeout: 120_000,
    providerProfiles: README_DEMO_FIXTURES.providerProfiles
  });
  updateIntegrationSetting({
    capability: "web_search",
    providerId: "exa",
    configuration: {},
    credentialAction: "clear"
  });

  resetDemoSkills();
  resetDemoMcpServers();

  const localAdmin = await createLocalUser(README_DEMO_FIXTURES.localAdmin);
  const member = await createLocalUser(README_DEMO_FIXTURES.member);

  updateGeneralSettingsForUser(localAdmin.id, {
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 120,
    mcpTimeout: 120_000
  });
  updateIntegrationSetting({
    capability: "web_search",
    providerId: "exa",
    configuration: {},
    credentialAction: "clear"
  }, localAdmin.id);

  updateGeneralSettingsForUser(member.id, {
    conversationRetention: "30d",
    memoriesEnabled: true,
    memoriesMaxCount: 60
  });
  updateIntegrationSetting({
    capability: "web_search",
    providerId: "disabled",
    configuration: {},
    credentialAction: "clear"
  }, member.id);

  const personas = README_DEMO_FIXTURES.personas.map((persona) =>
    createPersona(persona, envSuperAdmin.id)
  );

  README_DEMO_FIXTURES.memories.forEach((memory) =>
    createMemory(memory.content, memory.category, envSuperAdmin.id)
  );

  const launchOpsFolder = createFolder(README_DEMO_FIXTURES.folders[0], envSuperAdmin.id);
  const playbooksFolder = createFolder(README_DEMO_FIXTURES.folders[1], envSuperAdmin.id);

  const primaryConversation = createConversation(
    README_DEMO_FIXTURES.primaryConversationTitle,
    launchOpsFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
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
    envSuperAdmin.id
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
      daysOfWeek: [],
      enabled: false
    },
    envSuperAdmin.id
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
    envSuperAdmin.id
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

  for (const fixture of README_DEMO_FIXTURES.extraAutomations) {
    const extra = createAutomation(
      {
        name: fixture.name,
        prompt: fixture.prompt,
        providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id,
        personaId: personas[0]?.id ?? null,
        scheduleKind: fixture.scheduleKind,
        intervalMinutes: fixture.scheduleKind === "interval" ? fixture.intervalMinutes : null,
        calendarFrequency: fixture.scheduleKind === "calendar" ? fixture.calendarFrequency : null,
        timeOfDay: fixture.scheduleKind === "calendar" ? fixture.timeOfDay : null,
        daysOfWeek: fixture.daysOfWeek ?? [],
        enabled: fixture.enabled
      },
      envSuperAdmin.id
    );

    const shouldSeedRun = fixture.name === "Morning brief · blockers" || fixture.name === "Weekly README drift check" || fixture.name === "Provider health poll";

    if (!shouldSeedRun) {
      continue;
    }

    const runScheduledFor =
      fixture.scheduleKind === "interval" ? "2026-04-15T08:00:00.000Z" : "2026-04-15T08:30:00.000Z";
    const run = createAutomationRun({
      automationId: extra.id,
      scheduledFor: runScheduledFor,
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, {
      status: "running",
      startedAt: "2026-04-15T08:30:12.000Z"
    });

    const runConversation = createConversation(
      `${fixture.name} · Apr 15`,
      launchOpsFolder.id,
      {
        providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id,
        origin: "automation",
        automationId: extra.id,
        automationRunId: run.id
      },
      envSuperAdmin.id
    );
    attachConversationToRun(run.id, runConversation.id);

    createMessage({
      conversationId: runConversation.id,
      role: "user",
      content: fixture.prompt
    });
    createMessage({
      conversationId: runConversation.id,
      role: "assistant",
      content: "Run complete. No new blockers, all providers healthy, and coverage is current."
    });

    updateAutomationRunStatus(run.id, {
      status: "completed",
      startedAt: "2026-04-15T08:30:12.000Z",
      finishedAt: "2026-04-15T08:31:48.000Z"
    });
  }

  const webSearchConversation = createConversation(
    README_DEMO_FIXTURES.webSearchConversationTitle,
    playbooksFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
  );

  createMessage({
    conversationId: webSearchConversation.id,
    role: "user",
    content:
      "What's the most reliable way to self-host an LLM stack in 2026? I want model routing, memory, and a usable admin UI."
  });

  const webSearchReply = createMessage({
    conversationId: webSearchConversation.id,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: webSearchReply.id,
    sortOrder: 0,
    content:
      "Self-hosting an LLM stack in 2026 comes down to three layers: a model gateway that routes across providers, a memory layer that keeps context cheap, and an admin UI that non-engineers can actually drive. Let me pull the current landscape."
  });

  const webSearchAction = createMessageAction({
    messageId: webSearchReply.id,
    kind: "mcp_tool_call",
    status: "completed",
    toolName: "web_search",
    label: "Web search",
    detail: "Searched the web for self-hosted LLM stack, model gateways, and open-source memory layers.",
    arguments: {
      query: "self-host LLM stack 2026 model routing memory admin UI",
      limit: 5
    },
    resultSummary: "5 sources reviewed",
    sortOrder: 1
  });
  markCompletedAction(webSearchAction.id);

  const agentBrowserAction = createMessageAction({
    messageId: webSearchReply.id,
    kind: "skill_load",
    status: "completed",
    skillId: "builtin-agent-browser",
    label: "Agent Browser",
    detail: "Browsed 3 pages to verify the sources: the OpenRouter routing docs, the Mem0 README, and the Open WebUI features page.",
    resultSummary: "3 pages read",
    sortOrder: 2
  });
  markCompletedAction(agentBrowserAction.id);

  createMessageTextSegment({
    messageId: webSearchReply.id,
    sortOrder: 3,
    content: `The mature pattern in 2026 is a **gateway-first architecture**: keep a local fallback model (Ollama, vLLM) and route to hosted models (OpenAI, Anthropic via OpenRouter) for heavy reasoning [1][3]. Memory is usually a small vector store plus a structured key-value layer so long-running agents stay cheap [2]. For the admin layer, self-hostable web UIs like Eidon and Open WebUI now cover multi-user auth, provider profiles, and per-team policies out of the box [4][5].

**Key takeaways:**
- Route by task, not just model size — keep coding and vision on specialist models.
- Store memories per-user, not globally, to avoid context bleed across teammates.
- Pick an admin UI that lets you swap providers without redeploying.

**Sources:**
1. OpenRouter — Model routing and fallback docs — https://openrouter.ai/docs
2. Mem0 — Open-source memory layer for LLMs — https://github.com/mem0ai/mem0
3. Ollama — Run large language models locally — https://ollama.com
4. Open WebUI — Self-hosted LLM interface — https://github.com/open-webui/open-webui
5. LiteLLM — Proxy for 100+ LLM providers — https://github.com/BerriAI/litellm`
  });

  const visualsConversation = createConversation(
    README_DEMO_FIXTURES.visualsConversationTitle,
    launchOpsFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
  );

  createMessage({
    conversationId: visualsConversation.id,
    role: "user",
    content:
      "Sketch out a deploy pipeline for Eidon with a pre-deploy check, a build step, and a gated rollout."
  });

  const visualsReply = createMessage({
    conversationId: visualsConversation.id,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: visualsReply.id,
    sortOrder: 0,
    content:
      "Here's the pipeline as code — a single guard function gates every deploy on the readiness checks:\n\n```ts\nexport async function deployEidon(opts: DeployOptions) {\n  const checks = await runPreDeployChecks(opts);\n  if (!checks.ok) {\n    throw new Error(\"Blocked: \" + checks.reason);\n  }\n  const artifact = await buildArtifact(opts.version);\n  await stageRollout(artifact, { strategy: \"canary\", windows: [5, 25, 100] });\n  return { version: opts.version, status: \"live\" };\n}\n```\n\nAnd the flow as a diagram — note the gate that blocks rollout until checks pass:\n\n```mermaid\nflowchart TD\n    A[Push to main] --> B{Pre-deploy checks}\n    B -- pass --> C[Build artifact]\n    B -- fail --> Z[Block deploy]\n    C --> D[Stage canary 5%]\n    D --> E{Metrics healthy?}\n    E -- yes --> F[Ramp to 100%]\n    E -- no --> G[Auto-rollback]\n    F --> H[Live]\n```"
  });

  const visualsCodeConversation = createConversation(
    README_DEMO_FIXTURES.visualsCodeConversationTitle,
    playbooksFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
  );

  createMessage({
    conversationId: visualsCodeConversation.id,
    role: "user",
    content:
      "Write me a small TypeScript token-bucket rate limiter I can drop into the API gateway."
  });

  const visualsCodeReply = createMessage({
    conversationId: visualsCodeConversation.id,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: visualsCodeReply.id,
    sortOrder: 0,
    content:
      "Here's a compact token-bucket limiter — one bucket per key, refilled lazily, and thread-safe enough for a single Node process:\n\n```ts\ntype Bucket = { tokens: number; updated: number };\n\nexport class RateLimiter {\n  private buckets = new Map<string, Bucket>();\n  constructor(private capacity: number, private refillPerSec: number) {}\n\n  private refill(b: Bucket, now: number) {\n    const elapsed = (now - b.updated) / 1000;\n    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);\n    b.updated = now;\n  }\n\n  tryConsume(key: string, now = Date.now()): boolean {\n    let b = this.buckets.get(key);\n    if (!b) {\n      b = { tokens: this.capacity, updated: now };\n      this.buckets.set(key, b);\n    }\n    this.refill(b, now);\n    if (b.tokens < 1) return false;\n    b.tokens -= 1;\n    return true;\n  }\n}\n```\n\nCall `tryConsume(userId)` on every request; returning `false` means you should respond `429 Too Many Requests`."
  });

  const visualsMermaidConversation = createConversation(
    README_DEMO_FIXTURES.visualsMermaidConversationTitle,
    playbooksFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
  );

  createMessage({
    conversationId: visualsMermaidConversation.id,
    role: "user",
    content:
      "Map out how a chat request flows through Eidon from the browser to the model response."
  });

  const visualsMermaidReply = createMessage({
    conversationId: visualsMermaidConversation.id,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: visualsMermaidReply.id,
    sortOrder: 0,
    content:
      "Here's the full request lifecycle — from the browser, through the API and provider router, down to the model, and back as a streamed response:\n\n```mermaid\nsequenceDiagram\n    participant U as Browser\n    participant A as Eidon API\n    participant R as Provider Router\n    participant M as LLM Provider\n    U->>A: POST /api/chat (messages, history)\n    A->>A: Load skills + memories\n    A->>R: Resolve provider profile\n    R->>M: Forward request (stream)\n    M-->>R: Stream tokens\n    R-->>A: Relay tokens\n    A-->>U: SSE token stream\n    A->>A: Persist message + segments\n    M-->>A: Stream complete\n    A-->>U: Final message + actions\n```"
  });

  const memoriesConversation = createConversation(
    README_DEMO_FIXTURES.memoriesConversationTitle,
    playbooksFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
  );

  createMessage({
    conversationId: memoriesConversation.id,
    role: "user",
    content:
      "Let's get you set up. I self-host everything, I route through OpenRouter by default, and my team works Toronto mornings / Abuja afternoons. Keep responses short with explicit owners."
  });

  const memoriesReply = createMessage({
    conversationId: memoriesConversation.id,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: memoriesReply.id,
    sortOrder: 0,
    content:
      "Got it — I've captured your setup so I can default to it going forward."
  });

  const memoryActionOne = createMessageAction({
    messageId: memoriesReply.id,
    kind: "create_memory",
    status: "completed",
    label: "Saved memory",
    detail: "Stored the preference for self-hosted deployments and OpenRouter (anthropic/claude-sonnet-4) as the default provider.",
    resultSummary: "Preference · self-hosted + OpenRouter default",
    sortOrder: 1
  });
  markCompletedAction(memoryActionOne.id);

  const memoryActionTwo = createMessageAction({
    messageId: memoriesReply.id,
    kind: "create_memory",
    status: "completed",
    label: "Saved memory",
    detail: "Stored the working-hours overlap as Toronto mornings and Abuja afternoons, so scheduling suggestions respect the team's overlap window.",
    resultSummary: "Location · Toronto mornings / Abuja afternoons",
    sortOrder: 2
  });
  markCompletedAction(memoryActionTwo.id);

  const memoryActionThree = createMessageAction({
    messageId: memoriesReply.id,
    kind: "create_memory",
    status: "completed",
    label: "Saved memory",
    detail: "Stored the communication preference: short summaries with explicit owners, dates, and rollback notes.",
    resultSummary: "Preference · concise summaries with owners",
    sortOrder: 3
  });
  markCompletedAction(memoryActionThree.id);

  createMessageTextSegment({
    messageId: memoriesReply.id,
    sortOrder: 4,
    content:
      "Three memories saved. I'll lean on these for routing, scheduling, and how I format answers."
  });

  return {
    envSuperAdminId: envSuperAdmin.id,
    localAdminId: localAdmin.id,
    memberId: member.id,
    primaryConversationId: primaryConversation.id,
    secondaryConversationId: secondaryConversation.id,
    automationConversationId: automationConversation.id,
    automationId: automation.id,
    automationRunId: completedRun.id,
    webSearchConversationId: webSearchConversation.id,
    visualsConversationId: visualsConversation.id,
    visualsCodeConversationId: visualsCodeConversation.id,
    visualsMermaidConversationId: visualsMermaidConversation.id,
    memoriesConversationId: memoriesConversation.id
  };
}

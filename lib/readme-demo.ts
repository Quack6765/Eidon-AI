import { attachConversationToRun, createAutomation, createAutomationRun, deleteAutomation, listAutomations, updateAutomationRunStatus } from "@/lib/automations";
import { createBot, deleteBot, ensureChiefBot, getChiefBot, listBots } from "@/lib/bots";
import { createBotRunRecord, updateBotRunStatus } from "@/lib/bot-runs";
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
import { getDb } from "@/lib/db";
import { createFolder, deleteFolder, listFolders } from "@/lib/folders";
import { createMcpServer, deleteMcpServer, listMcpServers } from "@/lib/mcp-servers";
import { createMemory, deleteMemory, listMemories, updateMemory } from "@/lib/memories";
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

// Run history has to be anchored to "now". Absolute dates go stale, and once a
// seeded run's scheduledFor drifts into the past the scheduler backfills every
// missed occurrence up to today and then fails a real run against the demo's
// placeholder API keys, which is exactly what a screenshot must not show.
const SEED_EPOCH = Date.now();

function minutesAgo(minutes: number) {
  return new Date(SEED_EPOCH - minutes * 60_000).toISOString();
}


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
    visionMode: "none" | "native" | "mcp" | "provider";
    visionProviderProfileId: string | null;
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
    visionProviderProfileId:
      overrides.visionProviderProfileId ?? defaults.visionProviderProfileId,
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
      content: "The public launch needs a feature-led README and proof screenshots before release.",
      pinned: true
    },
    {
      category: "preference" as const,
      content: "Prefer short summaries with explicit owners, dates, and rollback notes.",
      pinned: true
    },
    {
      category: "personal" as const,
      content: "Comfortable approving infra changes once Docker and restore steps are documented.",
      pinned: false
    },
    {
      category: "location" as const,
      content: "Primary overlap is Toronto mornings and Abuja afternoons.",
      pinned: false
    },
    {
      category: "other" as const,
      content: "Keep image generation labeled as coming at launch until it lands on main.",
      pinned: false
    }
  ],
  bots: [
    {
      name: "Research Desk",
      title: "Runs deep research and writes the brief",
      description:
        "Owns multi-source research. Searches, reads pages in full, and reports back with citations.",
      systemPrompt:
        "You research topics end to end. Always corroborate important claims across at least two independent sources and cite every URL you used."
    },
    {
      name: "Release Watch",
      title: "Tracks launch blockers and provider health",
      description:
        "Watches issues, deploy logs, and provider error rates. Escalates only what is actually blocking.",
      systemPrompt:
        "You monitor release readiness. Report blockers with an owner and a rollback note. Stay quiet when nothing is wrong."
    },
    {
      name: "Inbox Triage",
      title: "Sorts incoming asks into owners",
      description:
        "Reads the shared queue each morning and proposes who should own what.",
      systemPrompt:
        "You triage incoming requests. Group them by owner, flag anything urgent, and propose automations for work that repeats."
    },
    {
      name: "Docs Editor",
      title: "Keeps operator docs current",
      description:
        "Rewrites docs when the product moves. Biased toward short, accurate, self-hosting-first copy.",
      systemPrompt:
        "You maintain operator-facing documentation. Prefer short accurate sentences over comprehensive prose, and never document a feature you have not verified."
    }
  ],
  folders: ["Launch Ops", "Playbooks"],
  botMemories: [
    "The MCP authorization spec moved to OAuth 2.1 with PKCE in the 2025-06-18 revision.",
    "Composio Connect is the gateway we test remote MCP OAuth against.",
    "Docs Editor owns docs/ and should be messaged before any README restructure."
  ],
  primaryConversationTitle: "April launch control room",
  researchConversationTitle: "MCP auth spec · what changed",
  researchDraftConversationTitle: "Competitor landscape",
  researchDraftQuestion:
    "Compare the leading AI assistants for a small team that wants to own its data, and tell me where a self-hosted option genuinely wins or loses.",
  secondaryConversationTitle: "Provider fallback matrix",
  automationConversationTitle: "Nightly launch scan · latest run",
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
  researchConversationId: string;
  researchDraftConversationId: string;
  chiefBotId: string;
  chiefConversationId: string;
  researchDeskBotId: string;
  inboxTriageBotId: string;
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

function deleteDemoBots(userId: string) {
  for (const bot of listBots(userId)) {
    if (bot.isChief) continue;
    deleteBot(bot.id, userId);
  }

  const chief = getChiefBot(userId);

  if (chief) {
    getDb().prepare("DELETE FROM bots WHERE id = ?").run(chief.id);
    deleteConversation(chief.homeConversationId, userId);
  }
}

function deleteDemoAdminResources(userId: string) {
  deleteDemoBots(userId);

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

  updateGeneralSettingsForUser(member.id, {
    conversationRetention: "30d",
    memoriesEnabled: true,
    memoriesMaxCount: 60
  });

  const personas = README_DEMO_FIXTURES.personas.map((persona) =>
    createPersona(persona, envSuperAdmin.id)
  );

  README_DEMO_FIXTURES.memories.forEach((memory) => {
    const created = createMemory(memory.content, memory.category, envSuperAdmin.id);

    if (memory.pinned) {
      updateMemory(created.id, { pinned: true }, envSuperAdmin.id);
    }
  });

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

  // Pending rather than completed: memory writes surface as a proposal the user
  // approves, edits, or dismisses, and that approval step is the point.
  createMessageAction({
    messageId: assistantReply.id,
    kind: "create_memory",
    status: "pending",
    label: "Save memory",
    detail: "Noticed a durable preference worth keeping for future launches.",
    proposalState: "pending",
    proposalPayload: {
      operation: "create",
      targetMemoryId: null,
      proposedMemory: {
        content:
          "Label features that are not yet on main as upcoming in the docs, so operators never read a roadmap item as shipped.",
        category: "preference"
      }
    },
    proposalUpdatedAt: nowIso(),
    sortOrder: 5
  });

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
    scheduledFor: minutesAgo(25),
    triggerSource: "schedule"
  });

  updateAutomationRunStatus(completedRun.id, {
    status: "running",
    startedAt: minutesAgo(24)
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

  const automationReply = createMessage({
    conversationId: automationConversation.id,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: automationReply.id,
    sortOrder: 0,
    content:
      "Starting the nightly sweep. Checking the launch docs first, then provider health, then screenshot coverage."
  });

  const automationSkillAction = createMessageAction({
    messageId: automationReply.id,
    kind: "skill_load",
    status: "completed",
    skillId: releaseSkill?.id ?? null,
    label: "Loaded Release Radar",
    detail: "Loaded the launch-ops checklist so the sweep covers the same items every night.",
    resultSummary: "Checklist loaded",
    sortOrder: 1
  });
  markCompletedAction(automationSkillAction.id);

  const automationIssuesAction = createMessageAction({
    messageId: automationReply.id,
    kind: "mcp_tool_call",
    status: "completed",
    serverId: linearServer?.id ?? null,
    toolName: "search_issues",
    label: "Linear Cloud.search_issues",
    detail: "Queried open issues labelled launch, docs, or onboarding.",
    arguments: { query: "label:launch OR label:docs state:open", limit: 25 },
    resultSummary: "2 open, neither blocking",
    sortOrder: 2
  });
  markCompletedAction(automationIssuesAction.id);

  createMessageTextSegment({
    messageId: automationReply.id,
    sortOrder: 3,
    content: "Issues are clean. Now polling each configured provider."
  });

  const automationShellAction = createMessageAction({
    messageId: automationReply.id,
    kind: "shell_command",
    status: "completed",
    toolName: "execute_shell_command",
    label: "execute_shell_command",
    detail: "curl -s -o /dev/null -w '%{http_code} %{time_total}' https://openrouter.ai/api/v1/models",
    arguments: { command: "curl -s -o /dev/null -w '%{http_code} %{time_total}' https://openrouter.ai/api/v1/models" },
    resultSummary: "200 · 0.41s",
    sortOrder: 4
  });
  markCompletedAction(automationShellAction.id);

  const automationReadAction = createMessageAction({
    messageId: automationReply.id,
    kind: "mcp_tool_call",
    status: "completed",
    toolName: "read_page",
    label: "Read 2 pages",
    detail: "Re-read the install and providers docs to diff them against the shipped UI.",
    arguments: { urls: ["https://eidon.ai/docs/install", "https://eidon.ai/docs/providers"] },
    resultSummary: "2 pages read in full",
    sortOrder: 5
  });
  markCompletedAction(automationReadAction.id);

  createMessageTextSegment({
    messageId: automationReply.id,
    sortOrder: 6,
    content: `**Nightly sweep complete.** No blockers.

| Check | Result |
| --- | --- |
| Open launch issues | 2 open, neither blocking |
| Provider health | All 4 profiles responding, slowest 0.41s |
| Docs drift | Install copy matches the shipped flow |
| Screenshot coverage | 1 gap |

The only gap is a mobile providers screen with the admin controls visible. Everything else is current.`
  });

  updateAutomationRunStatus(completedRun.id, {
    status: "completed",
    startedAt: minutesAgo(24),
    finishedAt: minutesAgo(23)
  });

  // Earlier runs so the run-history view reads as history rather than a single row.
  for (const minutes of [85, 145, 205]) {
    const priorRun = createAutomationRun({
      automationId: automation.id,
      scheduledFor: minutesAgo(minutes),
      triggerSource: "schedule"
    });

    const priorConversation = createConversation(
      `${README_DEMO_FIXTURES.automation.name} · earlier run`,
      launchOpsFolder.id,
      {
        providerProfileId: README_DEMO_FIXTURES.providerProfiles[0].id,
        origin: "automation",
        automationId: automation.id,
        automationRunId: priorRun.id
      },
      envSuperAdmin.id
    );
    attachConversationToRun(priorRun.id, priorConversation.id);

    createMessage({
      conversationId: priorConversation.id,
      role: "user",
      content: README_DEMO_FIXTURES.automation.prompt
    });
    createMessage({
      conversationId: priorConversation.id,
      role: "assistant",
      content:
        "Nightly check complete. No new blockers, provider health is green, and screenshot coverage is current."
    });

    updateAutomationRunStatus(priorRun.id, {
      status: "completed",
      startedAt: minutesAgo(minutes - 1),
      finishedAt: minutesAgo(minutes - 2)
    });
  }

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

    const runScheduledFor = minutesAgo(2);
    const run = createAutomationRun({
      automationId: extra.id,
      scheduledFor: runScheduledFor,
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, {
      status: "running",
      startedAt: minutesAgo(2)
    });

    const runConversation = createConversation(
      `${fixture.name} · last run`,
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
      startedAt: minutesAgo(2),
      finishedAt: minutesAgo(1)
    });
  }

  const webSearchConversation = createConversation(
    README_DEMO_FIXTURES.webSearchConversationTitle,
    null,
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
      "Here's a compact token-bucket limiter — one bucket per key, refilled lazily:\n\n```ts\ntype Bucket = { tokens: number; updated: number };\n\nexport class RateLimiter {\n  private buckets = new Map<string, Bucket>();\n\n  constructor(\n    private capacity: number,\n    private refillPerSec: number\n  ) {}\n\n  tryConsume(key: string, now = Date.now()): boolean {\n    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };\n    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.updated) / 1000) * this.refillPerSec);\n    b.updated = now;\n    this.buckets.set(key, b);\n\n    if (b.tokens < 1) return false;\n    b.tokens -= 1;\n    return true;\n  }\n}\n```\n\nCall `tryConsume(userId)` on every request; `false` means respond `429 Too Many Requests`."
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
      "Here's the request lifecycle — the tool branch is the only part that varies:\n\n```mermaid\nflowchart TD\n    A[Chat request] --> B{Tool needed?}\n    B -- yes --> C[Run tool]\n    B -- no --> D[Stream reply]\n    C --> D\n```"
  });

  const memoriesConversation = createConversation(
    README_DEMO_FIXTURES.memoriesConversationTitle,
    null,
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

  const researchConversation = createConversation(
    README_DEMO_FIXTURES.researchConversationTitle,
    launchOpsFolder.id,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
  );

  createMessage({
    conversationId: researchConversation.id,
    role: "user",
    content:
      "Deep research: what changed in the MCP authorization spec this year, and what does a self-hosted client have to implement to stay compliant?"
  });

  const researchReply = createMessage({
    conversationId: researchConversation.id,
    role: "assistant",
    content: ""
  });

  const researchPlanAction = createMessageAction({
    messageId: researchReply.id,
    kind: "research_plan",
    status: "completed",
    label: "Research plan",
    detail: [
      "1. Find the current MCP authorization specification and identify the revision history",
      "2. Read each revision in full and extract what changed for clients",
      "3. Check reference implementations for how dynamic client registration is handled",
      "4. Cross-check the OAuth 2.1 and PKCE requirements against the spec text",
      "5. Compile a cited summary of the client-side obligations"
    ].join("\n"),
    resultSummary: "5-step plan approved",
    sortOrder: 0
  });
  markCompletedAction(researchPlanAction.id);

  createMessageTextSegment({
    messageId: researchReply.id,
    sortOrder: 1,
    content:
      "Working through the plan now. Starting with the specification itself, then the reference implementations."
  });

  const researchSearchAction = createMessageAction({
    messageId: researchReply.id,
    kind: "mcp_tool_call",
    status: "completed",
    toolName: "web_search",
    label: "Web search",
    detail:
      "Ran 4 parallel queries: MCP authorization spec revisions, OAuth 2.1 PKCE requirements, dynamic client registration RFC 7591, and MCP client compliance.",
    arguments: {
      queries: [
        "MCP authorization specification 2025-06-18",
        "OAuth 2.1 PKCE mandatory requirements",
        "RFC 7591 dynamic client registration",
        "MCP client authorization compliance"
      ]
    },
    resultSummary: "18 sources across 4 queries",
    sortOrder: 2
  });
  markCompletedAction(researchSearchAction.id);

  const researchReadAction = createMessageAction({
    messageId: researchReply.id,
    kind: "mcp_tool_call",
    status: "completed",
    toolName: "read_page",
    label: "Read 6 pages",
    detail:
      "Read the full text of the spec revisions, RFC 7591, RFC 9126, and two reference client implementations.",
    arguments: {
      urls: [
        "https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization",
        "https://datatracker.ietf.org/doc/html/rfc7591"
      ]
    },
    resultSummary: "6 pages read in full",
    sortOrder: 3
  });
  markCompletedAction(researchReadAction.id);

  createMessageTextSegment({
    messageId: researchReply.id,
    sortOrder: 4,
    content: `## MCP authorization: what changed

**Summary.** The 2025-06-18 revision replaced ad-hoc bearer tokens with a full **OAuth 2.1 + PKCE** flow and made **dynamic client registration** the default onboarding path [1][2]. A self-hosted client no longer needs pre-provisioned credentials for each server.

### What a client must implement

| Obligation | Required | Notes |
| --- | --- | --- |
| Authorization code flow with PKCE | Yes | \`S256\` challenge method only [1] |
| Dynamic client registration (RFC 7591) | Yes, where offered | Falls back to manual credentials [3] |
| Protected resource metadata discovery | Yes | Server advertises its authorization server [1] |
| Refresh token rotation | Recommended | Revoked tokens must surface as a reconnect state [2] |

### Open questions

- Token revocation is described but not mandated, so behaviour varies per gateway.
- Nothing in the spec bounds refresh-token lifetime, so clients should not assume one.

**Sources**
1. Model Context Protocol — Authorization (2025-06-18) — https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
2. OAuth 2.1 draft — https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1
3. RFC 7591 — OAuth 2.0 Dynamic Client Registration — https://datatracker.ietf.org/doc/html/rfc7591`
  });

  // Deliberately empty: the deep-research plan card is client-only state, so the
  // screenshot has to drive the real composer flow in a clean conversation.
  const researchDraftConversation = createConversation(
    README_DEMO_FIXTURES.researchDraftConversationTitle,
    null,
    {
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id
    },
    envSuperAdmin.id
  );

  createMessage({
    conversationId: researchDraftConversation.id,
    role: "user",
    content: README_DEMO_FIXTURES.researchDraftQuestion
  });

  const chiefBot = ensureChiefBot(envSuperAdmin.id);
  const seededBots = README_DEMO_FIXTURES.bots.map((fixture) => ({
    fixture,
    bot: createBot(
      {
        name: fixture.name,
        title: fixture.title,
        description: fixture.description,
        systemPrompt: fixture.systemPrompt
      },
      envSuperAdmin.id
    )
  }));

  const researchDesk = seededBots[0].bot;
  const releaseWatch = seededBots[1].bot;
  const inboxTriage = seededBots[2].bot;
  const docsEditor = seededBots[3].bot;

  README_DEMO_FIXTURES.botMemories.forEach((content) =>
    createMemory(content, "work", envSuperAdmin.id, { botId: researchDesk.id })
  );

  createMessage({
    conversationId: chiefBot.homeConversationId,
    role: "user",
    content: "Nobody owns our release checklist and things keep slipping. Can you fix that?"
  });

  const chiefFirstReply = createMessage({
    conversationId: chiefBot.homeConversationId,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: chiefFirstReply.id,
    sortOrder: 0,
    content:
      "That is recurring work with a clear scope, so it deserves a long-lived owner rather than a one-off task. I spun up a bot for it."
  });

  const createBotAction = createMessageAction({
    messageId: chiefFirstReply.id,
    kind: "create_bot",
    status: "completed",
    label: `Created ${releaseWatch.name}`,
    detail:
      "Scope: watch issues, deploy logs, and provider error rates. Escalate only genuine blockers, always with an owner and a rollback note.",
    resultSummary: `${releaseWatch.name} · ${releaseWatch.title}`,
    sortOrder: 1
  });
  markCompletedAction(createBotAction.id);

  createMessageTextSegment({
    messageId: chiefFirstReply.id,
    sortOrder: 2,
    content:
      "Release Watch has its own thread, workspace, and browser session. Message it directly, or bind an automation to it if you want a scheduled sweep."
  });

  createMessage({
    conversationId: chiefBot.homeConversationId,
    role: "user",
    content:
      "The MCP auth spec moved again. Find out exactly what changed and get our docs updated to match."
  });

  const chiefSecondReply = createMessage({
    conversationId: chiefBot.homeConversationId,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: chiefSecondReply.id,
    sortOrder: 0,
    content:
      "Splitting this in two: Research Desk pulls what actually changed, then Docs Editor lands the rewrite once the findings are in."
  });

  const messageResearchAction = createMessageAction({
    messageId: chiefSecondReply.id,
    kind: "message_bot",
    status: "completed",
    label: `Messaged ${researchDesk.name}`,
    detail:
      "Asked for a cited summary of the MCP authorization spec changes and the client-side obligations they create.",
    arguments: { bot: researchDesk.name },
    resultSummary:
      "Reported back: OAuth 2.1 + PKCE is now mandatory and dynamic client registration is the default onboarding path.",
    sortOrder: 1
  });
  markCompletedAction(messageResearchAction.id);

  const messageDocsAction = createMessageAction({
    messageId: chiefSecondReply.id,
    kind: "message_bot",
    status: "completed",
    label: `Messaged ${docsEditor.name}`,
    detail:
      "Handed over the findings and asked for the MCP docs page to be rewritten against them.",
    arguments: { bot: docsEditor.name },
    resultSummary: "Rewrote the MCP authorization section and flagged two stale screenshots.",
    sortOrder: 2
  });
  markCompletedAction(messageDocsAction.id);

  createMessageTextSegment({
    messageId: chiefSecondReply.id,
    sortOrder: 3,
    content:
      "Both reported back. The short version: OAuth 2.1 with PKCE is mandatory, dynamic client registration replaces per-server credentials, and our docs now say so. Two screenshots still show the old consent screen."
  });

  createQueuedMessage({
    conversationId: chiefBot.homeConversationId,
    content: "Ask Release Watch whether the stale screenshots block the release."
  });

  createMessage({
    conversationId: inboxTriage.homeConversationId,
    role: "user",
    content: "Anything in the queue I should look at before standup?"
  });

  const inboxTriageReply = createMessage({
    conversationId: inboxTriage.homeConversationId,
    role: "assistant",
    content: ""
  });

  createMessageTextSegment({
    messageId: inboxTriageReply.id,
    sortOrder: 0,
    content:
      "Three asks came in overnight and two of them repeat every week. I would rather schedule that than keep triaging it by hand."
  });

  createMessageAction({
    messageId: inboxTriageReply.id,
    kind: "create_automation",
    status: "pending",
    label: "Proposed an automation",
    detail: "Runs the queue sweep every weekday morning and posts the owners into this thread.",
    proposalState: "pending",
    proposalPayload: {
      name: "Weekday queue sweep",
      prompt:
        "Read the shared queue, group every open ask by owner, flag anything urgent, and post the result as a short list.",
      scheduleKind: "calendar",
      intervalMinutes: null,
      calendarFrequency: "daily",
      timeOfDay: "08:15",
      daysOfWeek: [1, 2, 3, 4, 5],
      providerProfileId: README_DEMO_FIXTURES.providerProfiles[1].id,
      personaId: null,
      continuePreviousConversation: false
    },
    proposalUpdatedAt: nowIso(),
    sortOrder: 1
  });

  setConversationActive(researchDesk.homeConversationId, true);

  const routineBotRun = createBotRunRecord({
    botId: releaseWatch.id,
    conversationId: releaseWatch.homeConversationId,
    triggerSource: "routine"
  });
  updateBotRunStatus(routineBotRun.id, {
    status: "completed",
    startedAt: minutesAgo(9),
    finishedAt: minutesAgo(7)
  });

  for (const bot of [researchDesk, docsEditor]) {
    const completedBotRun = createBotRunRecord({
      botId: bot.id,
      conversationId: bot.homeConversationId,
      triggerSource: "delegated"
    });
    updateBotRunStatus(completedBotRun.id, {
      status: "completed",
      startedAt: minutesAgo(18),
      finishedAt: minutesAgo(14)
    });
  }

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
    memoriesConversationId: memoriesConversation.id,
    researchConversationId: researchConversation.id,
    researchDraftConversationId: researchDraftConversation.id,
    chiefBotId: chiefBot.id,
    chiefConversationId: chiefBot.homeConversationId,
    researchDeskBotId: researchDesk.id,
    inboxTriageBotId: inboxTriage.id
  };
}

import { listAutomationRuns, listAutomations } from "@/lib/automations";
import { CHIEF_BOT_NAME, listBots, toBotSummary } from "@/lib/bots";
import { getConversationSnapshot, listConversations } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { listMcpServers } from "@/lib/mcp-servers";
import { listMemories } from "@/lib/memories";
import { listPersonas } from "@/lib/personas";
import {
  README_DEMO_FIXTURES,
  seedReadmeDemoData
} from "@/lib/readme-demo";
import { listRuntimeProviderProfiles, getSettingsForUser } from "@/lib/settings";
import { listSkills } from "@/lib/skills";
import { listUsers } from "@/lib/users";

describe("readme demo seed", () => {
  it("creates a screenshot-ready workspace with representative product data", async () => {
    const seeded = await seedReadmeDemoData();

    expect(listUsers().map((user) => user.username)).toEqual(
      expect.arrayContaining([
        "admin",
        README_DEMO_FIXTURES.localAdmin.username,
        README_DEMO_FIXTURES.member.username
      ])
    );

    expect(listRuntimeProviderProfiles().map((profile) => profile.name)).toEqual(
      expect.arrayContaining(README_DEMO_FIXTURES.providerProfiles.map((profile) => profile.name))
    );

    expect(listPersonas(seeded.envSuperAdminId).map((persona) => persona.name)).toEqual(
      expect.arrayContaining(README_DEMO_FIXTURES.personas.map((persona) => persona.name))
    );

    expect(listSkills().map((skill) => skill.name)).toEqual(
      expect.arrayContaining(README_DEMO_FIXTURES.skills.map((skill) => skill.name))
    );

    expect(listMcpServers().map((server) => server.name)).toEqual(
      expect.arrayContaining(README_DEMO_FIXTURES.mcpServers.map((server) => server.name))
    );

    expect(listFolders(seeded.envSuperAdminId).map((folder) => folder.name)).toEqual(
      expect.arrayContaining(README_DEMO_FIXTURES.folders)
    );

    expect(listMemories(seeded.envSuperAdminId)).toHaveLength(
      README_DEMO_FIXTURES.memories.length
    );

    const expectedAutomationNames = [
      README_DEMO_FIXTURES.automation.name,
      ...README_DEMO_FIXTURES.extraAutomations.map((automation) => automation.name)
    ];
    const automations = listAutomations(seeded.envSuperAdminId);
    expect(automations.map((automation) => automation.name)).toEqual(
      expect.arrayContaining(expectedAutomationNames)
    );
    expect(automations).toHaveLength(expectedAutomationNames.length);

    const automationRuns = listAutomationRuns(seeded.automationId, seeded.envSuperAdminId);
    expect(automationRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: seeded.automationConversationId,
          status: "completed"
        })
      ])
    );
    // Run history needs more than one row to be worth screenshotting.
    expect(automationRuns.length).toBeGreaterThan(1);
    expect(automationRuns.every((run) => run.status === "completed")).toBe(true);

    // Absolute dates would drift into the past and make the scheduler backfill
    // missed runs and then fail one against the demo's placeholder keys.
    const oldestRun = [...automationRuns].sort((a, b) =>
      a.scheduledFor.localeCompare(b.scheduledFor)
    )[0];
    expect(new Date(oldestRun.scheduledFor).getTime()).toBeGreaterThan(
      Date.now() - 24 * 60 * 60 * 1000
    );

    expect(
      listConversations(seeded.envSuperAdminId).map((conversation) => conversation.title)
    ).toEqual(
      expect.arrayContaining([
        README_DEMO_FIXTURES.webSearchConversationTitle,
        README_DEMO_FIXTURES.visualsConversationTitle,
        README_DEMO_FIXTURES.visualsCodeConversationTitle,
        README_DEMO_FIXTURES.visualsMermaidConversationTitle,
        README_DEMO_FIXTURES.memoriesConversationTitle
      ])
    );

    const webSearchSnapshot = getConversationSnapshot(
      seeded.webSearchConversationId,
      seeded.envSuperAdminId
    );
    expect(webSearchSnapshot?.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(webSearchSnapshot?.messages.some((message) => message.actions?.some((action) => action.kind === "mcp_tool_call"))).toBe(true);

    const visualsCodeSnapshot = getConversationSnapshot(
      seeded.visualsCodeConversationId,
      seeded.envSuperAdminId
    );
    expect(visualsCodeSnapshot?.conversation.title).toBe(
      README_DEMO_FIXTURES.visualsCodeConversationTitle
    );

    const memoriesSnapshot = getConversationSnapshot(
      seeded.memoriesConversationId,
      seeded.envSuperAdminId
    );
    expect(memoriesSnapshot?.messages.some((message) => message.actions?.some((action) => action.kind === "create_memory"))).toBe(true);

    const snapshot = getConversationSnapshot(
      seeded.primaryConversationId,
      seeded.envSuperAdminId
    );

    expect(snapshot?.conversation.title).toBe(README_DEMO_FIXTURES.primaryConversationTitle);
    expect(snapshot?.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(snapshot?.queuedMessages).toHaveLength(2);

    const assistantReply = snapshot?.messages.find((message) => message.role === "assistant");
    expect(assistantReply?.textSegments?.length).toBeGreaterThan(0);
    expect(assistantReply?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "skill_load", status: "completed" }),
        expect.objectContaining({ kind: "mcp_tool_call", status: "completed" }),
        expect.objectContaining({
          kind: "create_memory",
          status: "pending",
          proposalState: "pending"
        })
      ])
    );

    const settings = getSettingsForUser(seeded.envSuperAdminId);
    expect(settings.speechTranscription.providerId).toBe("browser");
    expect(settings.webSearch.providerId).toBe("exa");
  });

  it("seeds a bot roster with a chief, delegation history, and varied statuses", async () => {
    const seeded = await seedReadmeDemoData();

    const bots = listBots(seeded.envSuperAdminId).map(toBotSummary);

    expect(bots.filter((bot) => bot.isChief)).toHaveLength(1);
    expect(bots.map((bot) => bot.name)).toEqual(
      expect.arrayContaining([
        CHIEF_BOT_NAME,
        ...README_DEMO_FIXTURES.bots.map((bot) => bot.name)
      ])
    );

    // The roster screenshot needs more than one state visible at once.
    expect(bots.some((bot) => bot.status === "running")).toBe(true);
    expect(bots.some((bot) => bot.status === "idle")).toBe(true);
    expect(bots.some((bot) => bot.waitingForInput)).toBe(true);

    // No queued bot on purpose: "queued" is the one status that renders an amber
    // dot (components/agents/bot-status.tsx), and the roster shot is accent-only.
    expect(bots.some((bot) => bot.status === "queued")).toBe(false);

    // Research Desk owns its own private memory pool, separate from the account's.
    expect(
      listMemories(seeded.envSuperAdminId, undefined, { botId: seeded.researchDeskBotId })
    ).toHaveLength(README_DEMO_FIXTURES.botMemories.length);

    const chiefSnapshot = getConversationSnapshot(
      seeded.chiefConversationId,
      seeded.envSuperAdminId
    );
    const chiefActions = chiefSnapshot?.messages.flatMap((message) => message.actions ?? []) ?? [];

    expect(chiefActions.some((action) => action.kind === "create_bot")).toBe(true);
    expect(chiefActions.filter((action) => action.kind === "message_bot")).toHaveLength(2);

    // The delegate glyph only resolves an avatar when the label is exactly "Messaged <name>".
    chiefActions
      .filter((action) => action.kind === "message_bot")
      .forEach((action) => expect(action.label).toMatch(/^Messaged .+$/));
  });

  it("seeds a deep research transcript with a plan and cited report", async () => {
    const seeded = await seedReadmeDemoData();

    const snapshot = getConversationSnapshot(
      seeded.researchConversationId,
      seeded.envSuperAdminId
    );

    expect(snapshot?.conversation.title).toBe(
      README_DEMO_FIXTURES.researchConversationTitle
    );

    const actions = snapshot?.messages.flatMap((message) => message.actions ?? []) ?? [];
    expect(actions.some((action) => action.kind === "research_plan")).toBe(true);
    expect(actions.some((action) => action.toolName === "read_page")).toBe(true);
  });

  it("pins the memories that should stay in the prompt", async () => {
    const seeded = await seedReadmeDemoData();

    const pinned = listMemories(seeded.envSuperAdminId).filter((memory) => memory.pinned);

    expect(pinned).toHaveLength(
      README_DEMO_FIXTURES.memories.filter((memory) => memory.pinned).length
    );
  });

  it("can be re-run without duplicating the demo workspace", async () => {
    await seedReadmeDemoData();
    const secondSeed = await seedReadmeDemoData();

    expect(
      listUsers().filter((user) =>
        [
          README_DEMO_FIXTURES.localAdmin.username,
          README_DEMO_FIXTURES.member.username
        ].includes(user.username)
      )
    ).toHaveLength(2);

    expect(listPersonas(secondSeed.envSuperAdminId)).toHaveLength(
      README_DEMO_FIXTURES.personas.length
    );

    expect(
      listSkills().filter((skill) =>
        README_DEMO_FIXTURES.skills.some((fixture) => fixture.name === skill.name)
      )
    ).toHaveLength(README_DEMO_FIXTURES.skills.length);

    expect(
      listMcpServers().filter((server) =>
        README_DEMO_FIXTURES.mcpServers.some((fixture) => fixture.name === server.name)
      )
    ).toHaveLength(README_DEMO_FIXTURES.mcpServers.length);

    expect(listConversations(secondSeed.envSuperAdminId).map((conversation) => conversation.title)).toEqual(
      expect.arrayContaining([
        README_DEMO_FIXTURES.primaryConversationTitle,
        README_DEMO_FIXTURES.secondaryConversationTitle
      ])
    );

    expect(
      listAutomationRuns(secondSeed.automationId, secondSeed.envSuperAdminId).some(
        (run) => run.conversationId === secondSeed.automationConversationId
      )
    ).toBe(true);
  });
});

import { listAutomationRuns, listAutomations } from "@/lib/automations";
import { getConversationSnapshot, listConversations } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { listMcpServers } from "@/lib/mcp-servers";
import { listMemories } from "@/lib/memories";
import { listPersonas } from "@/lib/personas";
import {
  README_DEMO_FIXTURES,
  seedReadmeDemoData
} from "@/lib/readme-demo";
import { listProviderProfilesWithApiKeys, getSettingsForUser } from "@/lib/settings";
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

    expect(listProviderProfilesWithApiKeys().map((profile) => profile.name)).toEqual(
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
    expect(automationRuns).toEqual([
      expect.objectContaining({
        conversationId: seeded.automationConversationId,
        status: "completed"
      })
    ]);

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
        expect.objectContaining({ kind: "create_memory", status: "completed" })
      ])
    );

    const settings = getSettingsForUser(seeded.envSuperAdminId);
    expect(settings.speechTranscription.providerId).toBe("browser");
    expect(settings.webSearch.providerId).toBe("exa");
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

import { describe, expect, it } from "vitest";

import { buildToolDefinitions } from "@/lib/tool-definitions";

type TeamOptions = { isChief: boolean; roster: [] };

function botTools(botTeam?: TeamOptions) {
  return buildToolDefinitions({
    mcpToolSets: [],
    skills: [],
    loadedSkillIds: new Set<string>(),
    memoriesEnabled: false,
    effectiveVisionMode: "none",
    botTeam
  });
}

function toolNamed(name: string, botTeam: TeamOptions) {
  return botTools(botTeam).find((tool) => tool.function.name === name);
}

function parameterShape(tool: ReturnType<typeof toolNamed>) {
  return (tool?.function.parameters ?? {}) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

describe("bot instruction tool definitions", () => {
  it("requires instructions on create_bot", () => {
    const shape = parameterShape(toolNamed("create_bot", { isChief: true, roster: [] }));
    expect(shape.properties?.instructions).toBeTruthy();
    expect(shape.required).toContain("instructions");
  });

  it("spells the update_bot instruction parameter instructions", () => {
    const shape = parameterShape(toolNamed("update_bot", { isChief: true, roster: [] }));
    expect(shape.properties?.instructions).toBeTruthy();
    expect(shape.properties?.system_prompt).toBeUndefined();
  });

  it("offers update_own_instructions to every bot on a team but not outside bot conversations", () => {
    expect(botTools().map((tool) => tool.function.name)).not.toContain("update_own_instructions");
    expect(botTools({ isChief: true, roster: [] }).map((tool) => tool.function.name)).toContain(
      "update_own_instructions"
    );
    expect(botTools({ isChief: false, roster: [] }).map((tool) => tool.function.name)).toContain(
      "update_own_instructions"
    );

    const shape = parameterShape(toolNamed("update_own_instructions", { isChief: false, roster: [] }));
    expect(shape.required).toEqual(["instructions"]);
  });

  it("offers create_bot and update_bot only to the chief", () => {
    const chiefNames = botTools({ isChief: true, roster: [] }).map((tool) => tool.function.name);
    const workerNames = botTools({ isChief: false, roster: [] }).map((tool) => tool.function.name);

    expect(chiefNames).toContain("create_bot");
    expect(chiefNames).toContain("update_bot");
    expect(workerNames).not.toContain("create_bot");
    expect(workerNames).not.toContain("update_bot");
  });
});

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

function toolNamed(name: string, botTeam?: TeamOptions) {
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

  it("offers the browser hand-off and vault tools in every conversation, not only to bots", () => {
    for (const botTeam of [undefined, { isChief: true, roster: [] as [] }, { isChief: false, roster: [] as [] }]) {
      expect(botTools(botTeam).map((tool) => tool.function.name)).toEqual(
        expect.arrayContaining(["request_takeover", "request_secret", "list_secrets", "save_secret"])
      );
    }
  });

  it("names request_secret's vault entry with name instead of label", () => {
    const shape = parameterShape(toolNamed("request_secret"));
    expect(shape.properties?.name).toBeTruthy();
    expect(shape.properties?.label).toBeUndefined();
    expect(shape.required).toEqual(["name", "origin", "target"]);
  });

  it("describes list_secrets without parameters and save_secret with an optional value", () => {
    expect(parameterShape(toolNamed("list_secrets"))).toEqual({ type: "object", properties: {} });

    const save = parameterShape(toolNamed("save_secret"));
    expect(Object.keys(save.properties ?? {})).toEqual(["name", "secret", "origin", "username", "notes"]);
    expect(save.required).toEqual(["name"]);
  });

  it("lets execute_shell_command take vault secrets as environment variables", () => {
    const secrets = parameterShape(toolNamed("execute_shell_command")).properties?.secrets as {
      type: string;
      items: { properties: Record<string, unknown>; required: string[] };
    };
    expect(secrets.type).toBe("array");
    expect(Object.keys(secrets.items.properties)).toEqual(["name", "variable"]);
    expect(secrets.items.required).toEqual(["name", "variable"]);
    expect(parameterShape(toolNamed("execute_shell_command")).required).toEqual(["command"]);
  });
});

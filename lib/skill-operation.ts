export type SkillOperation =
  | { name: string; action: "create"; content: string; category?: string | null }
  | {
      name: string;
      action: "patch";
      content?: string;
      oldString?: string;
      newString?: string;
      replaceAll?: boolean;
      filePath?: string | null;
    }
  | { name: string; action: "write_file"; filePath: string; fileContent: string }
  | { name: string; action: "remove_file"; filePath: string }
  | { name: string; action: "delete"; absorbedInto?: string | null };

export const SKILL_MANAGE_BATCH_MAX_OPS = 20;

const SKILL_ACTIONS = new Set(["create", "patch", "write_file", "remove_file", "delete", "edit"]);

export function normalizeSkillOperation(input: unknown): SkillOperation | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "each operation must be an object with name and action." };
  }

  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const action = typeof raw.action === "string" ? raw.action.trim() : "";

  if (!name) {
    return { error: "name is required on every operation." };
  }
  if (!SKILL_ACTIONS.has(action)) {
    return {
      error: `Unknown action '${action}'. Use: create, patch, delete, write_file, remove_file`
    };
  }

  const str = (value: unknown) => (typeof value === "string" ? value : undefined);

  switch (action) {
    case "create": {
      const content = str(raw.content);
      if (content === undefined) {
        return { error: "create requires 'content' — the full SKILL.md text (YAML frontmatter + markdown body)." };
      }
      return { name, action: "create", content, category: str(raw.category) ?? null };
    }

    case "edit":
    case "patch": {
      const content = str(raw.content);
      const oldString = str(raw.old_string) ?? str(raw.oldString);
      const newString = str(raw.new_string) ?? str(raw.newString);
      const filePath = str(raw.file_path) ?? str(raw.filePath) ?? null;

      if (content !== undefined) {
        return { name, action: "patch", content, filePath };
      }
      if (oldString === undefined && newString === undefined) {
        return { error: "Provide either old_string + new_string, or content for a full rewrite." };
      }
      if (oldString === undefined || newString === undefined) {
        return { error: "patch requires both old_string and new_string." };
      }
      return {
        name,
        action: "patch",
        oldString,
        newString,
        replaceAll: raw.replace_all === true || raw.replaceAll === true,
        filePath
      };
    }

    case "write_file": {
      const filePath = str(raw.file_path) ?? str(raw.filePath);
      const fileContent = str(raw.file_content) ?? str(raw.fileContent);
      if (filePath === undefined || fileContent === undefined) {
        return { error: "write_file requires file_path and file_content." };
      }
      return { name, action: "write_file", filePath, fileContent };
    }

    case "remove_file": {
      const filePath = str(raw.file_path) ?? str(raw.filePath);
      if (filePath === undefined) {
        return { error: "remove_file requires file_path." };
      }
      return { name, action: "remove_file", filePath };
    }

    default: {
      return { name, action: "delete", absorbedInto: str(raw.absorbed_into) ?? str(raw.absorbedInto) ?? null };
    }
  }
}

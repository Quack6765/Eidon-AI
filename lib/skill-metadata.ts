export type SkillContentMetadata = {
  name?: string;
  description?: string;
  shellCommandPrefixes: string[];
};

function trimMatchingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseInlineArray(value: string) {
  const trimmed = value.trim();

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split(",")
    .map((entry) => trimMatchingQuotes(entry.trim()))
    .filter(Boolean);
}

function normalizePrefixes(prefixes: string[]) {
  return [...new Set(prefixes.map((prefix) => prefix.trim()).filter(Boolean))];
}

export function parseSkillContentMetadata(content: string): SkillContentMetadata {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);

  if (!match) {
    return {
      shellCommandPrefixes: []
    };
  }

  const lines = match[1].split("\n");
  let name: string | undefined;
  let description: string | undefined;
  const shellCommandPrefixes: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const keyValueMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);

    if (!keyValueMatch) {
      continue;
    }

    const key = keyValueMatch[1].toLowerCase();
    const value = keyValueMatch[2].trim();

    if (key === "name" && value) {
      name = trimMatchingQuotes(value);
      continue;
    }

    if (key === "description" && value) {
      description = trimMatchingQuotes(value);
      continue;
    }

    if (
      key === "shell_command_prefixes" ||
      key === "allowed_command_prefixes" ||
      key === "command_prefixes"
    ) {
      if (value) {
        shellCommandPrefixes.push(...parseInlineArray(value));
        continue;
      }

      for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
        const nestedRawLine = lines[nestedIndex];
        const nestedLine = nestedRawLine.trim();

        if (!nestedLine) {
          continue;
        }

        if (!nestedRawLine.startsWith(" ") && !nestedRawLine.startsWith("\t")) {
          break;
        }

        const arrayItemMatch = nestedLine.match(/^-\s*(.+)$/);

        if (arrayItemMatch) {
          shellCommandPrefixes.push(trimMatchingQuotes(arrayItemMatch[1].trim()));
        }

        index = nestedIndex;
      }
    }
  }

  return {
    name,
    description,
    shellCommandPrefixes: normalizePrefixes(shellCommandPrefixes)
  };
}

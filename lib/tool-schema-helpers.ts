type InputSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
};

type PropertySchema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: unknown[];
  description?: string;
};

const ENUM_ALIAS_GROUPS = [
  { aliases: ["24h", "1d", "d", "day", "today", "daily"], candidates: ["24h", "day"] },
  { aliases: ["1w", "7d", "w", "week", "weekly"], candidates: ["week"] },
  { aliases: ["1m", "30d", "m", "month", "monthly"], candidates: ["month"] },
  { aliases: ["1y", "365d", "y", "year", "yearly", "annual"], candidates: ["year"] },
  { aliases: ["all", "any", "anytime", "ever"], candidates: ["any"] },
  { aliases: ["news", "web", "search"], candidates: ["general"] }
] as const;

function getEnumAliasMatch(normalizedValue: string, validValues: string[]): string | null {
  for (const group of ENUM_ALIAS_GROUPS) {
    if (!(group.aliases as readonly string[]).includes(normalizedValue)) continue;
    for (const candidate of group.candidates) {
      const match = validValues.find((value) => value.toLowerCase() === candidate);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

function getStringDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [];
    for (let j = 0; j <= b.length; j++) {
      matrix[i][j] = i === 0 ? j : j === 0 ? i : 0;
    }
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function getAllowedStringValues(prop: PropertySchema): string[] {
  const values = new Set<string>();

  if (Array.isArray(prop.enum)) {
    for (const value of prop.enum) {
      if (typeof value === "string") {
        values.add(value);
      }
    }
  }

  if (typeof prop.const === "string") {
    values.add(prop.const);
  }

  if (Array.isArray(prop.anyOf)) {
    for (const option of prop.anyOf) {
      if (!option || typeof option !== "object") continue;
      for (const value of getAllowedStringValues(option as PropertySchema)) {
        values.add(value);
      }
    }
  }

  return [...values];
}

export function extractEnumHints(schema: InputSchema): string {
  const props = schema.properties;
  if (!props) return "";

  const hints: string[] = [];
  for (const [name, propSchema] of Object.entries(props)) {
    const prop = propSchema as PropertySchema;
    const values = getAllowedStringValues(prop);
    if (values.length > 0) {
      hints.push(`Valid values for ${name}: ${values.join(", ")}.`);
    }
  }
  return hints.join(" ");
}

export function coerceEnumValues(
  schema: InputSchema,
  args: Record<string, unknown>
): Record<string, unknown> {
  const props = schema.properties;
  if (!props) return args;

  const corrected = { ...args };
  for (const [name, value] of Object.entries(corrected)) {
    const propSchema = props[name];
    if (!propSchema) continue;
    const prop = propSchema as PropertySchema;
    if (typeof value !== "string") continue;

    const validValues = getAllowedStringValues(prop);
    if (validValues.length === 0) continue;
    if (validValues.includes(value)) continue;

    const normalizedValue = value.toLowerCase();
    const exactMatch = validValues.find((v) => v.toLowerCase() === normalizedValue);
    if (exactMatch) {
      corrected[name] = exactMatch;
      continue;
    }

    const aliasMatch = getEnumAliasMatch(normalizedValue, validValues);
    if (aliasMatch) {
      corrected[name] = aliasMatch;
      continue;
    }

    let bestMatch = validValues[0];
    let bestDistance = getStringDistance(normalizedValue, bestMatch.toLowerCase());
    for (let i = 1; i < validValues.length; i++) {
      const dist = getStringDistance(normalizedValue, validValues[i].toLowerCase());
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = validValues[i];
      }
    }
    corrected[name] = bestMatch;
  }
  return corrected;
}

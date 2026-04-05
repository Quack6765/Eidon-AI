type InputSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
};

type PropertySchema = {
  type?: string;
  enum?: unknown[];
  description?: string;
};

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

export function extractEnumHints(schema: InputSchema): string {
  const props = schema.properties;
  if (!props) return "";

  const hints: string[] = [];
  for (const [name, propSchema] of Object.entries(props)) {
    const prop = propSchema as PropertySchema;
    if (prop.type === "string" && Array.isArray(prop.enum) && prop.enum.length > 0) {
      const values = prop.enum.map(String);
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
    if (prop.type !== "string" || !Array.isArray(prop.enum) || typeof value !== "string") continue;

    const validValues = prop.enum.map(String);
    if (validValues.includes(value)) continue;

    const normalizedValue = value.toLowerCase();
    const exactMatch = validValues.find((v) => v.toLowerCase() === normalizedValue);
    if (exactMatch) {
      corrected[name] = exactMatch;
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

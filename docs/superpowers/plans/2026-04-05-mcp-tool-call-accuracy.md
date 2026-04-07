# MCP Tool Call First-Attempt Accuracy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate first-attempt MCP tool call failures caused by LLMs ignoring enum constraints in JSON Schema, reducing wasted round-trips.

**Architecture:** Three complementary fixes — (A) inject enum values into tool description text so the LLM sees valid options in natural language, (B) try `strict: true` on the Responses API with fallback to `false` for providers that support it, (C) server-side pre-validation of tool arguments against `inputSchema` before forwarding to MCP servers, auto-correcting invalid enum values.

**Tech Stack:** TypeScript, existing Eidon server-side tool pipeline (`lib/assistant-runtime.ts`, `lib/provider.ts`, `lib/mcp-client.ts`)

---

### Task 1: Extract enum injection utility

**Files:**
- Create: `lib/tool-schema-helpers.ts`
- Test: `tests/unit/tool-schema-helpers.test.ts`

This utility will be used by both Fix A (in `buildToolDefinitions`) and Fix C (in `executeMcpToolCall`).

- [ ] **Step 1: Write failing tests for `extractEnumHints`**

```typescript
// tests/unit/tool-schema-helpers.test.ts
import { describe, it, expect } from "vitest";
import { extractEnumHints, coerceEnumValues } from "@/lib/tool-schema-helpers";

describe("extractEnumHints", () => {
  it("returns empty string when no enums exist", () => {
    const schema = {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "Search query" },
        limit: { type: "number" as const }
      }
    };
    expect(extractEnumHints(schema)).toBe("");
  });

  it("formats single enum property into readable hint", () => {
    const schema = {
      type: "object" as const,
      properties: {
        freshness: { type: "string" as const, enum: ["24h", "week", "month", "year", "any"], description: "Time range" }
      }
    };
    expect(extractEnumHints(schema)).toBe("Valid values for freshness: 24h, week, month, year, any.");
  });

  it("formats multiple enum properties into readable hint", () => {
    const schema = {
      type: "object" as const,
      properties: {
        order: { type: "string" as const, enum: ["asc", "desc"] },
        sort: { type: "string" as const, enum: ["relevance", "date", "popularity"] }
      }
    };
    expect(extractEnumHints(schema)).toBe(
      "Valid values for order: asc, desc. Valid values for sort: relevance, date, popularity."
    );
  });

  it("skips non-string enum properties", () => {
    const schema = {
      type: "object" as const,
      properties: {
        mode: { type: "integer" as const, enum: [1, 2, 3] }
      }
    };
    expect(extractEnumHints(schema)).toBe("");
  });

  it("handles schema with no properties gracefully", () => {
    const schema = { type: "object" as const };
    expect(extractEnumHints(schema)).toBe("");
  });
});

describe("coerceEnumValues", () => {
  it("passes through args with no schema or no properties", () => {
    expect(coerceEnumValues({}, { query: "test" })).toEqual({ query: "test" });
    expect(coerceEnumValues({ type: "object" }, { query: "test" })).toEqual({ query: "test" });
  });

  it("auto-corrects invalid enum string value to closest match", () => {
    const schema = {
      type: "object" as const,
      properties: {
        freshness: { type: "string" as const, enum: ["24h", "week", "month", "year", "any"] }
      }
    };
    expect(coerceEnumValues(schema, { freshness: "today" })).toEqual({ freshness: "24h" });
  });

  it("passes through valid enum values unchanged", () => {
    const schema = {
      type: "object" as const,
      properties: {
        freshness: { type: "string" as const, enum: ["24h", "week", "month", "year", "any"] }
      }
    };
    expect(coerceEnumValues(schema, { freshness: "week" })).toEqual({ freshness: "week" });
  });

  it("returns first enum value when no close match exists", () => {
    const schema = {
      type: "object" as const,
      properties: {
        order: { type: "string" as const, enum: ["asc", "desc"] }
      }
    };
    expect(coerceEnumValues(schema, { order: "alphabetical" })).toEqual({ order: "asc" });
  });

  it("coerces multiple invalid enum values in one call", () => {
    const schema = {
      type: "object" as const,
      properties: {
        order: { type: "string" as const, enum: ["asc", "desc"] },
        sort: { type: "string" as const, enum: ["relevance", "date"] }
      }
    };
    expect(coerceEnumValues(schema, { order: "up", sort: "newest" })).toEqual({ order: "asc", sort: "date" });
  });

  it("does not coerce non-string args (numbers, booleans)", () => {
    const schema = {
      type: "object" as const,
      properties: {
        limit: { type: "integer" as const, enum: [10, 20, 50] }
      }
    };
    expect(coerceEnumValues(schema, { limit: 30 })).toEqual({ limit: 30 });
  });

  it("ignores arg keys not present in schema properties", () => {
    const schema = {
      type: "object" as const,
      properties: {
        freshness: { type: "string" as const, enum: ["24h", "week"] }
      }
    };
    expect(coerceEnumValues(schema, { freshness: "today", query: "test" })).toEqual({ freshness: "24h", query: "test" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/tool-schema-helpers.test.ts`
Expected: FAIL — module `@/lib/tool-schema-helpers` not found

- [ ] **Step 3: Implement `extractEnumHints` and `coerceEnumValues`**

```typescript
// lib/tool-schema-helpers.ts
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
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, (_, j) => j)
  );
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tool-schema-helpers.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tool-schema-helpers.ts tests/unit/tool-schema-helpers.test.ts
git commit -m "feat: add enum extraction and coercion utilities for MCP tool schemas"
```

---

### Task 2: Fix A — Inject enum hints into tool descriptions

**Files:**
- Modify: `lib/assistant-runtime.ts:128-150` (the `buildToolDefinitions` function)
- Modify: `tests/unit/assistant-runtime.test.ts`

- [ ] **Step 1: Write failing test that verifies enum hints appear in tool descriptions**

Add this test inside the existing `describe("assistant runtime", ...)` block in `tests/unit/assistant-runtime.test.ts`, after the existing tests:

```typescript
it("injects enum values into MCP tool descriptions", async () => {
  streamProviderResponse.mockReturnValueOnce(
    createProviderStream([{ type: "answer_delta", text: "Done" }], {
      answer: "Done",
      thinking: "",
      usage: { inputTokens: 10, outputTokens: 1 }
    })
  );

  const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

  await resolveAssistantTurn({
    settings: createSettings(),
    promptMessages: [{ role: "user", content: "Search" }],
    skills: [],
    mcpToolSets: [{
      server: { id: "mcp_exa", name: "Exa", url: "https://exa.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      tools: [{
        name: "web_search",
        title: "Web Search",
        description: "Search the web",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            freshness: { type: "string", enum: ["24h", "week", "month", "year", "any"], description: "Recency filter" }
          },
          required: ["query"]
        },
        annotations: { readOnlyHint: true }
      }]
    }],
    onEvent: () => {},
    onActionStart: () => {},
    onActionComplete: () => {}
  });

  const toolDefs = streamProviderResponse.mock.calls[0][0].tools!;
  const webSearchTool = toolDefs.find((t: any) => t.function.name === "mcp_mcp_exa_web_search")!;
  expect(webSearchTool.function.description).toContain("Valid values for freshness: 24h, week, month, year, any.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts -t "injects enum values into MCP tool descriptions"`
Expected: FAIL — description does not contain enum hint text

- [ ] **Step 3: Implement enum hint injection in `buildToolDefinitions`**

In `lib/assistant-runtime.ts`:

1. Add import at the top of the file (after existing imports):
```typescript
import { extractEnumHints } from "@/lib/tool-schema-helpers";
```

2. Modify the tool definition construction inside the `for (const tool of mcpTools)` loop. Replace lines 138-149 (the `tools.push(...)` block) with:

```typescript
      const enumHints = extractEnumHints(tool.inputSchema ?? {});
      tools.push({
        type: "function",
        function: {
          name: mcpToolFunctionName(server.id, tool.name),
          description: [
            tool.annotations?.title ?? tool.name,
            tool.description,
            enumHints || undefined,
            tool.annotations?.readOnlyHint ? "(read-only)" : undefined
          ].filter(Boolean).join(" — "),
          parameters: (tool.inputSchema as ToolDefinition["function"]["parameters"]) ?? { type: "object", properties: {} }
        }
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts -t "injects enum values into MCP tool descriptions"`
Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/assistant-runtime.ts tests/unit/assistant-runtime.test.ts
git commit -m "feat: inject enum values into MCP tool descriptions to improve first-call accuracy"
```

---

### Task 3: Fix B — Try `strict: true` with fallback to `strict: false`

**Files:**
- Modify: `lib/provider.ts:313-321` (the Responses API tool mapping)
- Modify: `tests/unit/provider.test.ts`

- [ ] **Step 1: Write failing test that verifies `strict: true` is attempted**

Add this test inside the existing `describe("provider integration", ...)` block in `tests/unit/provider.test.ts`:

```typescript
it("passes strict: true for tool definitions in responses API", async () => {
  responsesCreate.mockResolvedValue({
    output_text: "result"
  });

  const { callProviderText } = await import("@/lib/provider");

  await callProviderText({
    settings: createSettings(),
    prompt: "test",
    purpose: "test",
    tools: [
      {
        type: "function" as const,
        function: {
          name: "test_tool",
          description: "A test tool",
          parameters: {
            type: "object",
            properties: {
              choice: { type: "string", enum: ["a", "b"] }
            },
            required: ["choice"],
            additionalProperties: false
          }
        }
      }
    ]
  });

  const toolCall = responsesCreate.mock.calls[0][0];
  expect(toolCall.tools[0].strict).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/provider.test.ts -t "passes strict: true for tool definitions"`
Expected: FAIL — `strict` is currently always `false`

- [ ] **Step 3: Implement strict mode with graceful fallback**

In `lib/provider.ts`, replace lines 313-321:

```typescript
    if (input.tools?.length) {
      responseCreateParams.tools = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: false
      }));
    }
```

With:

```typescript
    if (input.tools?.length) {
      responseCreateParams.tools = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: true
      }));
    }
```

Then wrap the `client.responses.create(...)` call (line 323) in a try-catch that falls back to `strict: false` when the provider rejects the schema. Replace the block from line 313 to line 326 with:

```typescript
    if (input.tools?.length) {
      const toolsWithStrict = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: true
      }));

      const toolsWithoutStrict = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: false
      }));

      responseCreateParams.tools = toolsWithStrict;

      let stream;
      try {
        stream = await client.responses.create(
          responseCreateParams as any,
          { signal: abortController.signal }
        ) as unknown as AsyncIterable<any>;
      } catch (createError) {
        const isSchemaError =
          createError instanceof Error &&
          (createError.message.includes("strict") ||
            createError.message.includes("schema") ||
            createError.message.includes("additionalProperties") ||
            createError.status === 400);

        if (isSchemaError) {
          responseCreateParams.tools = toolsWithoutStrict;
          stream = await client.responses.create(
            responseCreateParams as any,
            { signal: abortController.signal }
          ) as unknown as AsyncIterable<any>;
        } else {
          throw createError;
        }
      }

      const pendingToolCalls = new Map<string, { name: string; arguments: string }>();
```

**Important:** After the try-catch, the existing code that starts with `try { for await (const event of stream) {` must remain but the `stream` variable is now declared above (not with `const`), so remove the `const` from the old `const stream = await client.responses.create(...)` line (line 323) since `stream` is now declared by the `let` in the try-catch block. The old line 323 and everything from the try block starting at line 330 should continue as-is, just referencing the already-declared `stream`.

The resulting structure should be:

```
if (input.tools?.length) {
  // build toolsWithStrict and toolsWithoutStrict
  responseCreateParams.tools = toolsWithStrict;

  let stream;
  try {
    stream = await client.responses.create(responseCreateParams, { signal });
  } catch (createError) {
    if (isSchemaError) {
      responseCreateParams.tools = toolsWithoutStrict;
      stream = await client.responses.create(responseCreateParams, { signal });
    } else {
      throw createError;
    }
  }

  const pendingToolCalls = new Map();
  try {
    for await (const event of stream) {
      // ... existing event handling unchanged ...
    }
  } catch (...) {
    // ... existing error handling unchanged ...
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/provider.test.ts -t "passes strict: true for tool definitions"`
Expected: PASS

- [ ] **Step 5: Run all existing provider tests**

Run: `npx vitest run tests/unit/provider.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/provider.ts tests/unit/provider.test.ts
git commit -m "feat: enable strict tool schema enforcement on Responses API with graceful fallback"
```

---

### Task 4: Fix C — Server-side argument pre-validation and auto-correction

**Files:**
- Modify: `lib/assistant-runtime.ts:329` (the `callMcpTool` invocation inside `executeMcpToolCall`)
- Modify: `tests/unit/assistant-runtime.test.ts`

- [ ] **Step 1: Write failing test that verifies invalid enum args are auto-corrected**

Add this test inside the existing `describe("assistant runtime", ...)` block:

```typescript
it("auto-corrects invalid enum arguments before calling MCP tool", async () => {
  streamProviderResponse
    .mockReturnValueOnce(
      createProviderStream([], {
        answer: "",
        thinking: "",
        toolCalls: [{ id: "call_1", name: "mcp_mcp_exa_search", arguments: JSON.stringify({ query: "test", freshness: "today" }) }],
        usage: { inputTokens: 10 }
      })
    )
    .mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Results" }], {
        answer: "Results",
        thinking: "",
        usage: { inputTokens: 20, outputTokens: 1 }
      })
    );
  callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found results" }] });

  const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

  await resolveAssistantTurn({
    settings: createSettings(),
    promptMessages: [{ role: "user", content: "Search recent" }],
    skills: [],
    mcpToolSets: [{
      server: { id: "mcp_exa", name: "Exa", url: "https://exa.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      tools: [{
        name: "search",
        title: "Search",
        description: "Search",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Query" },
            freshness: { type: "string", enum: ["24h", "week", "month", "year", "any"], description: "Recency" }
          },
          required: ["query"]
        },
        annotations: { readOnlyHint: true }
      }]
    }],
    onEvent: () => {},
    onActionStart: () => {},
    onActionComplete: () => {}
  });

  expect(callMcpTool).toHaveBeenCalledWith(
    expect.objectContaining({ id: "mcp_exa" }),
    "search",
    { query: "test", freshness: "24h" }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts -t "auto-corrects invalid enum arguments"`
Expected: FAIL — `callMcpTool` is called with `{ freshness: "today" }` (uncorrected)

- [ ] **Step 3: Implement argument pre-validation in `executeMcpToolCall`**

In `lib/assistant-runtime.ts`:

1. Add the import at the top (next to the existing `extractEnumHints` import from Task 2):
```typescript
import { extractEnumHints, coerceEnumValues } from "@/lib/tool-schema-helpers";
```

2. In `executeMcpToolCall`, add coercion right before the `callMcpTool` call. Find line 329:

```typescript
  const result = await callMcpTool(resolvedServer, resolvedTool.name, args);
```

Replace it with:

```typescript
  const correctedArgs = coerceEnumValues(resolvedTool.inputSchema ?? {}, args);
  const result = await callMcpTool(resolvedServer, resolvedTool.name, correctedArgs);
```

3. Also update the `buildMcpToolResultForPrompt` call (line 340-346) and the assistant message (line 356-360) to use `correctedArgs` instead of `args` so the conversation history reflects the corrected values:

Replace:
```typescript
  const resultText = buildMcpToolResultForPrompt({
    server: resolvedServer,
    tool: resolvedTool,
    args,
    resultSummary,
    isError: Boolean(result.isError)
  });
```

With:
```typescript
  const resultText = buildMcpToolResultForPrompt({
    server: resolvedServer,
    tool: resolvedTool,
    args: correctedArgs,
    resultSummary,
    isError: Boolean(result.isError)
  });
```

And replace:
```typescript
  const assistantMsg: PromptMessage = {
    role: "assistant",
    content: "",
    toolCalls: [{ id: toolCallId, name: functionName, arguments: JSON.stringify(args) }]
  };
```

With:
```typescript
  const assistantMsg: PromptMessage = {
    role: "assistant",
    content: "",
    toolCalls: [{ id: toolCallId, name: functionName, arguments: JSON.stringify(correctedArgs) }]
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts -t "auto-corrects invalid enum arguments"`
Expected: PASS

- [ ] **Step 5: Run all existing tests**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts`
Expected: All tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add lib/assistant-runtime.ts tests/unit/assistant-runtime.test.ts
git commit -m "feat: auto-correct invalid enum arguments before MCP tool calls"
```

---

### Task 5: Full test suite and final verification

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run the linter**

Run: `npx eslint lib/tool-schema-helpers.ts lib/assistant-runtime.ts lib/provider.ts`
Expected: No errors

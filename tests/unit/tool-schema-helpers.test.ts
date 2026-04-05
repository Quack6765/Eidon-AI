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
    expect(coerceEnumValues(schema, { freshness: "today" })).toEqual({ freshness: "month" });
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

  it("normalizes case-insensitive exact matches to proper casing", () => {
    const schema = {
      type: "object" as const,
      properties: {
        order: { type: "string" as const, enum: ["asc", "desc"] }
      }
    };
    expect(coerceEnumValues(schema, { order: "ASC" })).toEqual({ order: "asc" });
    expect(coerceEnumValues(schema, { order: "Desc" })).toEqual({ order: "desc" });
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

import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY } from "@/lib/model-registry";

describe("model registry", () => {
  it("has at least one entry", () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every entry has a prefix", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.prefix).toBeTruthy();
      expect(typeof entry.prefix).toBe("string");
    }
  });

  it("has no duplicate prefixes", () => {
    const prefixes = MODEL_REGISTRY.map((e) => e.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("longer prefixes come before shorter ones that share a root", () => {
    for (let i = 0; i < MODEL_REGISTRY.length; i++) {
      for (let j = i + 1; j < MODEL_REGISTRY.length; j++) {
        const a = MODEL_REGISTRY[i].prefix;
        const b = MODEL_REGISTRY[j].prefix;
        if (b.startsWith(a)) {
          throw new Error(
            `Prefix "${b}" (index ${j}) extends "${a}" (index ${i}) but appears after it — longer prefixes must come before shorter ones`
          );
        }
      }
    }
  });

  it("every entry has at least one override (not just a prefix)", () => {
    for (const entry of MODEL_REGISTRY) {
      const { prefix, ...overrides } = entry;
      expect(Object.keys(overrides).length).toBeGreaterThan(0);
    }
  });
});

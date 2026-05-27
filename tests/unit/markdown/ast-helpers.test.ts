import { describe, it, expect } from "vitest";
import {
  countMarkerRuns,
  pipeDensity,
  endsWithSentenceTerminator,
} from "@/lib/markdown/ast-helpers";

describe("ast-helpers", () => {
  describe("countMarkerRuns", () => {
    it("counts ** runs while ignoring escaped asterisks", () => {
      expect(countMarkerRuns("a **b** c \\**d\\** e **f", "**")).toBe(3);
    });
    it("counts ` runs", () => {
      expect(countMarkerRuns("a `b` c `d", "`")).toBe(3);
    });
  });

  describe("pipeDensity", () => {
    it("returns pipes per 80 chars", () => {
      expect(pipeDensity("| a | b | c | d | e |")).toBeGreaterThan(0.2);
      expect(pipeDensity("hello world there friend")).toBe(0);
    });
  });

  describe("endsWithSentenceTerminator", () => {
    it("recognizes . ! ? as terminators", () => {
      expect(endsWithSentenceTerminator("Done.")).toBe(true);
      expect(endsWithSentenceTerminator("Why?")).toBe(true);
      expect(endsWithSentenceTerminator("Wow!")).toBe(true);
    });
    it("returns false otherwise", () => {
      expect(endsWithSentenceTerminator("Done")).toBe(false);
      expect(endsWithSentenceTerminator("And then")).toBe(false);
    });
  });
});

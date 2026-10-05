import { describe, expect, it } from "vitest";

import {
  filterReferenceOptions,
  findActiveReferenceQuery,
  findReferencedNames,
  findReferenceTokens,
  toReferenceCandidates
} from "@/lib/reference-tokens";

const candidates = toReferenceCandidates({
  bots: [
    { name: "Writer", title: "Copywriter", avatarSeed: "seed-writer" },
    { name: "Writer Pro", title: "", avatarSeed: "seed-pro" },
    { name: "Chief of Staff", title: "", avatarSeed: "seed-chief" }
  ],
  skills: [{ name: "daily-report", description: "Summarize the day" }]
});

describe("findReferenceTokens", () => {
  it("finds bot and skill tokens with their positions", () => {
    const text = "@Writer run /daily-report now";

    expect(findReferenceTokens(text, candidates)).toEqual([
      { trigger: "@", name: "Writer", start: 0, end: 7 },
      { trigger: "/", name: "daily-report", start: 12, end: 25 }
    ]);
  });

  it("prefers the longest name and matches names with spaces case-insensitively", () => {
    const tokens = findReferenceTokens("ask @writer pro and @CHIEF OF STAFF.", candidates);

    expect(tokens.map((token) => token.name)).toEqual(["Writer Pro", "Chief of Staff"]);
  });

  it("requires a token boundary on both sides", () => {
    const text = "mail me@Writer, see docs/daily-report, or @Writers and /daily-reports";

    expect(findReferenceTokens(text, candidates)).toEqual([]);
  });

  it("accepts punctuation after a token and opening punctuation before it", () => {
    const tokens = findReferenceTokens("(@Writer's draft) \"/daily-report\"", candidates);

    expect(tokens.map((token) => token.name)).toEqual(["Writer", "daily-report"]);
  });

  it("ignores tokens inside inline code and fenced code blocks", () => {
    const text = "run `/daily-report now` then\n```\n@Writer inside\n```\n@Writer /daily-report";
    const tokens = findReferenceTokens(text, candidates);

    expect(tokens.map((token) => text.slice(token.start, token.end))).toEqual(["@Writer", "/daily-report"]);
    expect(tokens[0].start).toBe(text.lastIndexOf("@Writer"));
  });

  it("returns nothing when there are no candidates", () => {
    expect(findReferenceTokens("@Writer", [])).toEqual([]);
  });
});

describe("findReferencedNames", () => {
  it("returns each referenced name once, using the canonical casing", () => {
    expect(findReferencedNames("/Release Notes then /release notes", "/", ["Release Notes"])).toEqual([
      "Release Notes"
    ]);
  });

  it("only looks at the requested trigger", () => {
    expect(findReferencedNames("@Writer /Writer", "/", ["Writer"])).toEqual(["Writer"]);
    expect(findReferencedNames("/Writer", "@", ["Writer"])).toEqual([]);
  });
});

describe("findActiveReferenceQuery", () => {
  it("returns the query typed after a trigger", () => {
    expect(findActiveReferenceQuery("hi @wri", 7, ["@", "/"])).toEqual({ trigger: "@", query: "wri", start: 3 });
    expect(findActiveReferenceQuery("/", 1, ["/"])).toEqual({ trigger: "/", query: "", start: 0 });
  });

  it("keeps spaces inside the query so multi-word names stay reachable", () => {
    expect(findActiveReferenceQuery("@Chief of", 9, ["@"])).toEqual({ trigger: "@", query: "Chief of", start: 0 });
  });

  it("ignores triggers that are disabled, mid-word, on a previous line, or followed by a space", () => {
    expect(findActiveReferenceQuery("@wri", 4, ["/"])).toBeNull();
    expect(findActiveReferenceQuery("a@wri", 5, ["@"])).toBeNull();
    expect(findActiveReferenceQuery("@wri\nnext", 9, ["@"])).toBeNull();
    expect(findActiveReferenceQuery("@ wri", 5, ["@"])).toBeNull();
    expect(findActiveReferenceQuery("hello", 5, [])).toBeNull();
  });
});

describe("filterReferenceOptions", () => {
  const options = [
    { name: "Writer", detail: "Copywriter" },
    { name: "Rewriter", detail: "" },
    { name: "Chief of Staff", detail: "Runs the team" }
  ];

  it("returns every option for an empty query", () => {
    expect(filterReferenceOptions(options, "")).toEqual(options);
  });

  it("ranks prefix matches before substring and detail matches", () => {
    expect(filterReferenceOptions(options, "wri").map((option) => option.name)).toEqual(["Writer", "Rewriter"]);
    expect(filterReferenceOptions(options, "team").map((option) => option.name)).toEqual(["Chief of Staff"]);
  });

  it("closes once a completed name is followed by whitespace", () => {
    expect(filterReferenceOptions(options, "Writer ")).toEqual([]);
    expect(filterReferenceOptions(options, "chief ").map((option) => option.name)).toEqual(["Chief of Staff"]);
  });
});

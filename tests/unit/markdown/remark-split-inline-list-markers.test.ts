import { describe, it, expect } from "vitest";
import remarkSplitInlineListMarkers from "@/lib/markdown/plugins/remark-split-inline-list-markers";
import { runPlugin } from "./_harness";

describe("remark-split-inline-list-markers", () => {
  it("splits sibling items separated by ` * ` markers", () => {
    const input =
      "- Cargo haulers * Class-A heavy freighters * Sub-type: Deep space variants";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("- Cargo haulers");
    expect(out).toContain("- Class-A heavy freighters");
    expect(out).toContain("- Sub-type: Deep space variants");
  });

  it("does not fire on single inline ` * ` (ambiguous with emphasis/asterisk)", () => {
    const input = "- one * two";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toBe("- one \\* two");
  });

  it("preserves trailing sub-list children on the last new item", () => {
    const input = "- a * b * c\n\n  - sub of last";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("- c");
    expect(out).toContain("- sub of last");
  });

  it("ignores inline asterisks inside strong markers (`** **`)", () => {
    const input = "- **A * B** is bold";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("**A \\* B**");
    expect(out).not.toMatch(/^- B/m);
  });

  it("is idempotent", () => {
    const input = "- a * b * c";
    const once = runPlugin(input, remarkSplitInlineListMarkers);
    const twice = runPlugin(once, remarkSplitInlineListMarkers);
    expect(twice).toBe(once);
  });

  it("splits a heading with glued inline list markers into heading + list", () => {
    const input =
      "### Key Features* High Performance: Processes up to 5 million events per second* Scalability: Horizontally scales from 1 to 10,000 nodes";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^### Key Features\s*$/m);
    expect(out).toMatch(/^- High Performance: Processes up to 5 million events per second$/m);
    expect(out).toMatch(/^- Scalability: Horizontally scales from 1 to 10,000 nodes$/m);
  });

  it("splits a paragraph with bold label + 2 inline list markers into paragraph + list", () => {
    const input =
      "**Key Features*** High Performance: Processes up to 5 million events per second* Scalability: Horizontally scales from 1 to 10,000 nodes";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/\*\*Key Features\*\*/);
    expect(out).toMatch(/^- High Performance: Processes up to 5 million events per second$/m);
    expect(out).toMatch(/^- Scalability: Horizontally scales from 1 to 10,000 nodes$/m);
  });

  it("leaves a heading without inline list markers unchanged", () => {
    const input = "### Just a normal heading with no list markers";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toBe("### Just a normal heading with no list markers");
  });

  it("does not split a paragraph with only 1 inline marker (too risky)", () => {
    const input = "Sentence with one* Capital after it";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).not.toMatch(/^- /m);
  });

  it("preserves inline strikethrough/code formatting in split-out list items", () => {
    const input =
      "### Key Features* High Performance: Up to ~~1 million~~ 5 million events* Scalability: Uses `kubernetes` pods";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("~~1 million~~");
    expect(out).toContain("`kubernetes`");
    expect(out).toMatch(/^- High Performance/m);
    expect(out).toMatch(/^- Scalability/m);
  });

  it("splits a heading where the list item starts with inline code", () => {
    const input =
      "### Key Endpoints* `GET /api/v1/users` retrieves users* `POST /api/v1/users` creates a user";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^### Key Endpoints\s*$/m);
    expect(out).toMatch(/^- `GET \/api\/v1\/users`/m);
    expect(out).toMatch(/^- `POST \/api\/v1\/users`/m);
  });

  it("emits only the list when heading body starts directly with markers", () => {
    const input = "### * First Item* Second Item";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^- First Item$/m);
    expect(out).toMatch(/^- Second Item$/m);
  });

  it("ignores list markers inside a paragraph nested in a listItem", () => {
    const input = "- prose with* Capital marker* Another marker here";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^- prose with$/m);
    expect(out).toMatch(/^- Capital marker$/m);
    expect(out).toMatch(/^- Another marker here$/m);
  });

  it("nests inline numbered markers under the parent listItem label", () => {
    const input =
      "1. **Ingestion Layer** 1. Raw data arrives via multiple channels 2. Schema validation occurs";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^1\.\s+\*\*Ingestion Layer\*\*/m);
    expect(out).toMatch(/^\s+1\.\s+Raw data arrives via multiple channels$/m);
    expect(out).toMatch(/^\s+2\.\s+Schema validation occurs$/m);
  });

  it("nests inline numbered markers even when glued to closing bold (no space)", () => {
    const input =
      "1. **Processing Layer**1. Stream processors handle real-time data 2. Batch processors run scheduled jobs";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^1\.\s+\*\*Processing Layer\*\*/m);
    expect(out).toMatch(/^\s+1\.\s+Stream processors handle real-time data$/m);
    expect(out).toMatch(/^\s+2\.\s+Batch processors run scheduled jobs$/m);
  });

  it("splits a heading with inline ordered list markers into heading + ordered list", () => {
    const input =
      "### Storage Tiers 1. Hot storage (Redis) 2. Warm storage (PostgreSQL) 3. Cold storage (S3)";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^### Storage Tiers\s*$/m);
    expect(out).toMatch(/^1\.\s+Hot storage \(Redis\)$/m);
    expect(out).toMatch(/^2\.\s+Warm storage \(PostgreSQL\)$/m);
    expect(out).toMatch(/^3\.\s+Cold storage \(S3\)$/m);
  });

  it("splits a top-level paragraph with bold label + inline ordered markers", () => {
    const input =
      "**Storage Layer** 1. Hot storage (Redis cache) 2. Warm storage (PostgreSQL) 3. Cold storage (S3 Glacier)";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/\*\*Storage Layer\*\*/);
    expect(out).toMatch(/^1\.\s+Hot storage \(Redis cache\)$/m);
    expect(out).toMatch(/^2\.\s+Warm storage \(PostgreSQL\)$/m);
    expect(out).toMatch(/^3\.\s+Cold storage \(S3 Glacier\)$/m);
  });

  it("does not split short year-like number sequences in normal prose", () => {
    const input = "She was born in 1990. Then again in 2005. He was born in 1985.";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).not.toMatch(/^1\.\s+Then/m);
    expect(out).toContain("She was born in 1990.");
    expect(out).toContain("He was born in 1985.");
  });

  it("splits a heading with ordered markers glued without space (Contents1. Item)", () => {
    const input =
      "## Table of Contents1. Architecture 2. Getting Started 3. API Reference 4. Contributing";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^## Table of Contents\s*$/m);
    expect(out).toMatch(/^1\.\s+Architecture$/m);
    expect(out).toMatch(/^2\.\s+Getting Started$/m);
    expect(out).toMatch(/^3\.\s+API Reference$/m);
    expect(out).toMatch(/^4\.\s+Contributing$/m);
  });

  it("does not split prose containing version numbers like 2.5 or 24.0", () => {
    const input = "Make sure you have version 2.5 of Node and Docker 24.0 installed.";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).not.toMatch(/^\d+\.\s+(Node|Docker)/m);
    expect(out).toContain("version 2.5 of Node");
    expect(out).toContain("Docker 24.0 installed");
  });

  it("splits inline task-list markers '- [ ] Item' into separate task list items", () => {
    const input =
      "- [ ] Database migrations applied- [ ] Load tests passed - [ ] < 200ms p95 latency";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*]\s+\[\s?\]\s+Database migrations applied$/m);
    expect(out).toMatch(/^[-*]\s+\[\s?\]\s+Load tests passed$/m);
    expect(out).toMatch(/^[-*]\s+\[\s?\]\s+< 200ms p95 latency$/m);
  });

  it("splits inline task-list markers regardless of [ ] / [x] / [X] check state", () => {
    const input =
      "- [x] Done task - [ ] Pending task - [X] Other done task";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/Done task/);
    expect(out).toMatch(/Pending task/);
    expect(out).toMatch(/Other done task/);
    expect(out.split("\n").filter((l) => /^[-*]\s+\[/.test(l)).length).toBeGreaterThanOrEqual(3);
  });

  it("normalizes malformed checkbox '[x ]' (space after x) into a checked task item", () => {
    const input = "- [x ] DNS records configured";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*]\s+\[x\]\s+DNS records configured$/m);
    expect(out).not.toContain("[x ]");
  });

  it("normalizes malformed checkbox '[ x]' (space before x) into a checked task item", () => {
    const input = "- [ x] DNS records configured";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*]\s+\[x\]\s+DNS records configured$/m);
    expect(out).not.toContain("[ x]");
  });

  it("normalizes malformed checkbox '[ x ]' (spaces around x) into a checked task item", () => {
    const input = "- [ x ] DNS records configured";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*]\s+\[x\]\s+DNS records configured$/m);
    expect(out).not.toContain("[ x ]");
  });

  it("normalizes malformed checkbox with uppercase '[X ]' into a checked task item", () => {
    const input = "- [X ] DNS records configured";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*]\s+\[x\]\s+DNS records configured$/m);
  });

  it("normalizes malformed empty checkbox '[  ]' (double space) into an unchecked task item", () => {
    const input = "- [  ] Load balancer health checks passing";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*]\s+\[\s?\]\s+Load balancer health checks passing$/m);
  });

  it("normalizes a malformed checkbox in a mixed list, leaving valid items intact", () => {
    const input =
      "- [x] Database migrations applied\n- [x ] DNS records configured\n- [ ] Load balancer health checks passing";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    const taskLines = out.split("\n").filter((l) => /^[-*]\s+\[[ xX]?\]/.test(l));
    expect(taskLines.length).toBe(3);
    expect(out).toMatch(/^[-*]\s+\[x\]\s+DNS records configured$/m);
  });

  it("does not treat a leading markdown link as a checkbox", () => {
    const input = "- [link text](https://example.com) is a normal list item";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("[link text](https://example.com)");
    expect(out).not.toMatch(/\[[ xX]\]/);
  });

  it("splits inline ordered markers in a sub-list item into siblings (any starting digit)", () => {
    const input =
      "1. Parent item\n   1. Sub-step 2.1 2. Sub-step 2.2 3. Sub-step 2.3";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    const indented = out.split("\n").filter((l) => /^\s{2,}\d+\.\s/.test(l));
    expect(indented.length).toBeGreaterThanOrEqual(3);
    expect(out).toContain("Sub-step 2.1");
    expect(out).toContain("Sub-step 2.2");
    expect(out).toContain("Sub-step 2.3");
  });

  it("splits glued digit-period-digit (3.11. Deep) preserving sub-id of previous item", () => {
    const input =
      "1. Parent\n   1. Sub-step 3.11. Deep sub-step 3.1.a 1. Very deep 3.1.a.i";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    const indented = out.split("\n").filter((l) => /^\s{2,}\d+\.\s/.test(l));
    expect(indented.length).toBeGreaterThanOrEqual(3);
    expect(out).toMatch(/^\s+\d+\.\s+Sub-step 3\.1$/m);
    expect(out).toMatch(/^\s+\d+\.\s+Deep sub-step 3\.1\.a$/m);
    expect(out).toMatch(/^\s+\d+\.\s+Very deep 3\.1\.a\.i$/m);
  });

  it("nests a single glued sub-marker preceded by 2+ spaces (Install dependencies   1. Run...)", () => {
    const input =
      "1. Clone the repository\n2. Install dependencies   1. Run the package manager:\n3. Configure environment";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*\d.]*\s*Install dependencies$/m);
    expect(out).toMatch(/^\s+\d+\.\s+Run the package manager:$/m);
    expect(out).not.toContain("Install dependencies   1.");
  });

  it("nests a single glued sub-marker preceded by a colon (Verify installation:1. Check...)", () => {
    const input =
      "1. Parent step\n   1. Verify installation:1. Check node_modules exists";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/Verify installation:$/m);
    expect(out).toMatch(/^\s+\d+\.\s+Check node\\?_modules exists$/m);
    expect(out).not.toContain("installation:1.");
  });

  it("does not nest a single low-confidence numbered reference (version 1. New)", () => {
    const input =
      "1. Clone the repo\n2. Upgrade to version 1. New features are included here";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("version 1. New features are included here");
  });

  it("does not nest a ratio-like colon number (ratio is 3:1. Capital follows)", () => {
    const input =
      "1. First step\n2. The ratio is 3:1. Capital letters follow this text";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("3:1. Capital letters follow this text");
  });

  it("does not nest a high-confidence single marker whose digit is not 1 (colon then 2.)", () => {
    const input =
      "1. Parent step\n   1. Section header:2. Second only without a first";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("Section header:2. Second only without a first");
  });

  it("leaves a checked task item with no malformed marker untouched", () => {
    const input = "- [x] Already valid task\n- [ ] Pending valid task";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toMatch(/^[-*]\s+\[x\]\s+Already valid task$/m);
    expect(out).toMatch(/^[-*]\s+\[\s?\]\s+Pending valid task$/m);
  });

  it("does not treat an empty bracket pair '[]' as a checkbox", () => {
    const input = "- [] not a checkbox just brackets";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("[] not a checkbox just brackets");
  });

  it("leaves an ordinary list item with no markers untouched", () => {
    const input = "1. Just a plain ordered item with prose only";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("Just a plain ordered item with prose only");
  });
});

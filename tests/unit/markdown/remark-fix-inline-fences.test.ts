// tests/unit/markdown/remark-fix-inline-fences.test.ts
import { describe, it, expect } from "vitest";
import remarkFixInlineFences from "@/lib/markdown/plugins/remark-fix-inline-fences";
import { runPlugin } from "./_harness";

describe("remark-fix-inline-fences", () => {
  it("(c) splits closer glued to following text", () => {
    const out = runPlugin(
      "```js\nconsole.log(\"hi\");\n```Start of other paragraph",
      remarkFixInlineFences
    );
    expect(out).toMatch(/```js\nconsole\.log\("hi"\);\n```/);
    expect(out).toMatch(/Start of other paragraph$/);
  });

  it("(d) splits an all-on-one-line code-like phrase into paragraphs", () => {
    const out = runPlugin(
      "some code```Start other paragraph",
      remarkFixInlineFences
    );
    expect(out).toContain("some code");
    expect(out).toContain("Start other paragraph");
  });

  it("leaves well-formed fenced blocks alone", () => {
    const input = "```js\nconsole.log(\"hi\");\n```";
    expect(runPlugin(input, remarkFixInlineFences)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "```js\nx = 1;\n```text after";
    const once = runPlugin(input, remarkFixInlineFences);
    const twice = runPlugin(once, remarkFixInlineFences);
    expect(twice).toBe(once);
  });

  it("(d) inline fence with non-empty before text", () => {
    const out = runPlugin(
      "intro text\n```js\ncode();\n```tail text",
      remarkFixInlineFences
    );
    expect(out).toContain("intro text");
    expect(out).toContain("```js");
    expect(out).toContain("code();");
    expect(out).toContain("tail text");
  });

  it("(d) inline fence with no before or tail — only code block", () => {
    const out = runPlugin("\n```js\ncode();\n```", remarkFixInlineFences);
    expect(out).toContain("```js");
    expect(out).toContain("code();");
  });

  it("promotes paragraph > inlineCode 'bash$ ...' to a real bash code block", () => {
    const out = runPlugin(
      "```bash$ phoenix apply -f phoenix.yaml```",
      remarkFixInlineFences
    );
    expect(out).toMatch(/```bash\n/);
    expect(out).toContain("$ phoenix apply -f phoenix.yaml");
  });

  it("does not promote arbitrary inline code spans to code blocks", () => {
    const input = "see `myFunction()` for details";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("`myFunction()`");
    expect(out).not.toMatch(/```/);
  });

  it("normalizes 'bash#' lang to 'bash' and prepends '#' to body", () => {
    const input = "```bash#\necho hi\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/```bash\n/);
    expect(out).toMatch(/^#/m);
  });

  it("normalizes 'json{' lang to 'json' and prepends '{' to body", () => {
    const input = '```json{\n  "x": 1\n```';
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/```json\n/);
    expect(out).toMatch(/^\{/m);
  });

  it("leaves valid lang identifiers alone", () => {
    const input = "```typescript\nconst x = 1;\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/```typescript\n/);
    expect(out).toContain("const x = 1;");
  });

  it("does not touch mermaid blocks even if their content contains stray backticks", () => {
    const input = "```mermaid\ngraph TD\n  A[\"`tick`\"] --> B[end]\n```\n\nNext paragraph";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("```mermaid");
    expect(out).toContain("graph TD");
    expect(out).toContain('A["`tick`"]');
    expect(out).toContain("--> B[end]");
    expect(out).toContain("Next paragraph");
  });

  it("splits glued env var assignments in a bash code block", () => {
    const input =
      '```bash\n# Header line\nENVIRONMENT="staging"VERSION="latest"echo "Deploying"\nkubectl apply -f ./manifest.yml\n```';
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^ENVIRONMENT="staging"$/m);
    expect(out).toMatch(/^VERSION="latest"$/m);
    expect(out).toMatch(/^echo "Deploying"$/m);
  });

  it("splits 'set -flags' glued to preceding word in a bash code block", () => {
    const input =
      '```bash\n# Deploy script for Atlasset -euo pipefail\nkubectl apply\n```';
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^# Deploy script for Atlas$/m);
    expect(out).toMatch(/^set -euo pipefail$/m);
  });

  it("does not split shell-script patterns in non-shell languages (python)", () => {
    const input =
      '```python\nset_value("foo")echo_back = process()\n```';
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain('set_value("foo")echo_back = process()');
  });

  it("preserves a well-formed bash code block (no spurious splits)", () => {
    const input =
      '```bash\n#!/bin/bash\nset -euo pipefail\nENVIRONMENT="prod"\necho "Hello"\n```';
    const out = runPlugin(input, remarkFixInlineFences);
    const lines = out.split("\n").filter((l) => l.trim() && !l.startsWith("```"));
    expect(lines.length).toBe(4);
  });

  it("does not split shell-line repairs inside mermaid code blocks", () => {
    const input =
      "```mermaid\ngraph TD\nA[Foo] --> B[Atlasset -euo pipefail]\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("A[Foo] --> B[Atlasset -euo pipefail]");
  });

  it("splits glued letter-only lang (typescriptinterface) using KNOWN_LANGS prefix", () => {
    const input =
      "```typescriptinterface ErrorBudget {\n  service: string;\n  remaining: number;\n}\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/```typescript\n/);
    expect(out).toMatch(/^interface ErrorBudget \{/m);
    expect(out).toContain("service: string;");
    expect(out).toContain("remaining: number;");
  });

  it("prepends meta to body when lang is split (typescriptinterface + meta)", () => {
    const input =
      "```typescriptinterface ErrorBudget {  service: string;  remaining: number;\n}\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/```typescript\n/);
    expect(out).toContain("interface ErrorBudget {");
    expect(out).toContain("service: string;");
    expect(out).toContain("remaining: number;");
  });

  it("splits other known-lang glued prefixes (javascriptconst, pythondef)", () => {
    const input1 = "```javascriptconst x = 1;\n```";
    const out1 = runPlugin(input1, remarkFixInlineFences);
    expect(out1).toMatch(/```javascript\n/);
    expect(out1).toContain("const x = 1;");

    const input2 = "```pythondef foo():\n    return 1\n```";
    const out2 = runPlugin(input2, remarkFixInlineFences);
    expect(out2).toMatch(/```python\n/);
    expect(out2).toContain("def foo():");
  });

  it("leaves typescriptreact alone since it is a real known lang variant", () => {
    const input = "```tsx\nconst x: JSX.Element = <div/>;\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/```tsx\n/);
    expect(out).toContain("const x: JSX.Element");
  });

  it("reconstructs a mermaid code block when heading is glued to opening fence", () => {
    const input =
      "### Architecture Overview```mermaid\ngraph TD\nA[Client] --> B[Load Balancer]\nB --> C[Web Tier]\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^### Architecture Overview\s*$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toContain("A[Client] --> B[Load Balancer]");
    expect(out).toContain("B --> C[Web Tier]");
  });

  it("reconstructs heading-glued fence when body is on a single glued line", () => {
    const input =
      "### Architecture Overview```mermaid\ngraph TD A[Client] --> B[Load Balancer] B --> C[Web Tier]\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^### Architecture Overview\s*$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toMatch(/^A\[Client\] --> B\[Load Balancer\]$/m);
    expect(out).toMatch(/^B --> C\[Web Tier\]$/m);
  });

  it("does not touch a well-formed heading + code block sequence", () => {
    const input = "### Title\n\n```mermaid\ngraph TD\nA --> B\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^### Title$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
  });

  it("reconstructs a code block when a paragraph is glued to the opening fence (orphan closer)", () => {
    const input =
      "The following diagram illustrates our system:```mermaid\ngraph TD\nA[Client] --> B[Server]\nB --> C[Database]\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/The following diagram illustrates our system:/);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toContain("A[Client] --> B[Server]");
    expect(out).toContain("B --> C[Database]");
  });

  it("does not fire on a paragraph with opening fence when no orphan closer follows", () => {
    const input = "Some text ```mermaid graph TD with no newline";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("Some text");
  });

  it("does not strip 'C' prefix from 'Company' lang (Title-case word, not glued lang)", () => {
    const input = "```Company Organization\n├── Engineering\n├── Sales\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).not.toMatch(/^```c$/m);
    expect(out).toContain("Company");
  });

  it("does not strip prefix from Title-case lang 'Project'", () => {
    const input = "```Project\nbody content\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).not.toMatch(/^```p$/m);
  });

  it("splits glued mermaid lang (mermaidgraph) into mermaid + graph TD body", () => {
    const input = "```mermaidgraph TD\nA --> B\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/```mermaid\n/);
    expect(out).toMatch(/^graph TD/m);
  });

  it("reconstructs code block when paragraph starts with known lang prefix glued to content + orphan closer", () => {
    const input =
      "mermaidgraph TD A[Client] --> B[Server]\nstyle A fill:#e1f5\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toMatch(/^graph TD$/m);
    expect(out).toMatch(/^A\[Client\] --> B\[Server\]$/m);
    expect(out).toMatch(/^style A fill:#e1f5$/m);
  });

  it("does not match arbitrary paragraphs starting with known lang word", () => {
    const input = "json is a popular data format used in APIs.";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("json is a popular data format");
    expect(out).not.toMatch(/```/);
  });

  it("strips trailing closing fence from body when heading is glued to opening fence", () => {
    const input =
      '### API Response Example```json\n{ "status": "success", "x": 1 }```';
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^### API Response Example\s*$/m);
    expect(out).toMatch(/^```json$/m);
    expect(out).toMatch(/^\{ "status": "success", "x": 1 \}$/m);
    expect(out).not.toMatch(/\}```/);
  });

  it("splits mermaid statements glued on a single line into separate lines", () => {
    const input =
      "```mermaid\ngraph TD A[Client] --> B[CDN] B --> C[Server]\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toMatch(/^graph TD$/m);
    expect(out).toMatch(/^A\[Client\] --> B\[CDN\]$/m);
    expect(out).toMatch(/^B --> C\[Server\]$/m);
  });

  it("splits 'style' directives onto their own line in mermaid blocks", () => {
    const input =
      "```mermaid\ngraph TD A --> B style A fill:#e1f5fe style B fill:#c8e6c9\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toMatch(/^style A fill:#e1f5fe$/m);
    expect(out).toMatch(/^style B fill:#c8e6c9$/m);
  });

  it("does not touch a well-formed mermaid block", () => {
    const input =
      "```mermaid\ngraph TD\nA[Client] --> B[Server]\nstyle A fill:#fff\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("graph TD");
    expect(out).toContain("A[Client] --> B[Server]");
    expect(out).toContain("style A fill:#fff");
    const lines = out.split("\n").filter((l) => l.trim() && !l.startsWith("```"));
    expect(lines.length).toBe(3);
  });

  it("splits glued sequenceDiagram header and participant declarations", () => {
    const input =
      "```mermaid\nsequenceDiagram    participant User    participant LB as Load Balancer\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^sequenceDiagram$/m);
    expect(out).toMatch(/^\s*participant User$/m);
    expect(out).toMatch(/^\s*participant LB as Load Balancer$/m);
  });

  it("splits glued sequenceDiagram arrow message statements", () => {
    const input =
      "```mermaid\nsequenceDiagram\n    LB->>GW: Route to Gateway    GW->>Auth: Validate JWT Token Auth-->>GW: Token Valid / Invalid\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^\s*LB->>GW: Route to Gateway$/m);
    expect(out).toMatch(/^\s*GW->>Auth: Validate JWT Token$/m);
    expect(out).toMatch(/^\s*Auth-->>GW: Token Valid \/ Invalid$/m);
  });

  it("splits 'else' and 'end' glued into sequenceDiagram message text", () => {
    const input =
      "```mermaid\nsequenceDiagram\n    alt Valid Token\n        LB-->>User: 200 OK else Invalid Token\n        GW-->>User: 401 Unauthorized    end\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^\s*LB-->>User: 200 OK$/m);
    expect(out).toMatch(/^\s*else Invalid Token$/m);
    expect(out).toMatch(/^\s*GW-->>User: 401 Unauthorized$/m);
    expect(out).toMatch(/^end$/m);
  });

  it("adds missing space after colon in sequenceDiagram arrow messages", () => {
    const input =
      "```mermaid\nsequenceDiagram\n    GW-->>User:401 Unauthorized\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^\s*GW-->>User: 401 Unauthorized$/m);
  });

  it("leaves well-formed sequenceDiagram alone (idempotent)", () => {
    const input =
      "```mermaid\nsequenceDiagram\n    participant User\n    participant LB\n    User->>LB: HTTPS Request\n    LB-->>User: 200 OK\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    const twice = runPlugin(out, remarkFixInlineFences);
    expect(twice).toBe(out);
    expect(out).toContain("participant User");
    expect(out).toContain("participant LB");
    expect(out).toContain("User->>LB: HTTPS Request");
    expect(out).toContain("LB-->>User: 200 OK");
  });

  it("does not modify graph (non-sequence) mermaid blocks with sequence patterns", () => {
    const input =
      "```mermaid\ngraph TD\nA[end of line] --> B[start]\nstyle A fill:#fff\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("A[end of line] --> B[start]");
    expect(out).toContain("style A fill:#fff");
  });

  it("does not duplicate body content when heading-glued mermaid body has no internal closing fence", () => {
    const input =
      "### Sequence View```mermaid\nsequenceDiagram\n    participant A\n    A->>B: hi";
    const out = runPlugin(input, remarkFixInlineFences);
    const occurrences = (out.match(/participant A/g) ?? []).length;
    expect(occurrences).toBe(1);
    const arrowOcc = (out.match(/A->>B: hi/g) ?? []).length;
    expect(arrowOcc).toBe(1);
  });

  it("splits two mermaid blocks chained by a closing-fence-heading-opening-fence sequence", () => {
    const input = "```mermaid\ngraph TD\nA --> B\nstyle A fill:#fff\n```### Service Dependencies```mermaid\nsequenceDiagram\n    participant Client\n    Client->>Server: hi\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    const mermaidBlocks = out.match(/```mermaid[\s\S]*?```/g) ?? [];
    expect(mermaidBlocks.length).toBe(2);
    expect(mermaidBlocks[0]).toContain("graph TD");
    expect(mermaidBlocks[0]).toContain("A --> B");
    expect(mermaidBlocks[0]).toContain("style A fill:#fff");
    expect(mermaidBlocks[1]).toContain("sequenceDiagram");
    expect(mermaidBlocks[1]).toContain("Client->>Server: hi");
    expect(out).toMatch(/^###?\s+Service Dependencies\s*$/m);
  });

  it("splits bare-identifier-glued arrow statements in mermaid graph diagrams", () => {
    const input =
      "```mermaid\ngraph TD\n    M -.->|Health Checks| C    M -.->|Health Checks| D\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^\s*M -\.->\|Health Checks\| C$/m);
    expect(out).toMatch(/^\s*M -\.->\|Health Checks\| D$/m);
  });

  it("adds missing space after colon in sequenceDiagram even when arrow label is mid-message", () => {
    const input =
      "```mermaid\nsequenceDiagram\n    Cache-->>Auth:3/100 requests used\n```";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^\s*Cache-->>Auth: 3\/100 requests used$/m);
  });

  it("reconstructs heading-glued mermaid block whose body spans multiple paragraphs and indented sections", () => {
    const input = `## System Architecture Diagram\`\`\`mermaid
graph TD
    Client --> CDN
    CDN --> LB

    API --> Cache
    Worker --> DB

    style Client fill:#e1f5fe    style API fill:#fff3e0\`\`\`---

## Next Section`;
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^## System Architecture Diagram$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toContain("Client --> CDN");
    expect(out).toContain("API --> Cache");
    expect(out).toContain("Worker --> DB");
    expect(out).toContain("style Client fill:#e1f5fe");
    expect(out).toContain("style API fill:#fff3e0");
    expect(out).toMatch(/^## Next Section$/m);
    expect(out).toMatch(/```mermaid[\s\S]+?```/);
    const codeBlocks = out.match(/```mermaid[\s\S]*?```/g) ?? [];
    expect(codeBlocks.length).toBe(1);
    // The single mermaid block must contain ALL the body content
    expect(codeBlocks[0]).toContain("graph TD");
    expect(codeBlocks[0]).toContain("API --> Cache");
    expect(codeBlocks[0]).toContain("Worker --> DB");
    expect(codeBlocks[0]).toContain("style Client fill:#e1f5fe");
    expect(codeBlocks[0]).toContain("style API fill:#fff3e0");
    // No orphan plain code block with mermaid content leaking out
    expect(out).not.toMatch(/^```\n[\s\S]*API --> Cache/m);
  });

  it("reconstructs heading-glued fence whose body paragraph contains the closing fence plus trailing prose", () => {
    const input =
      "## Flow Diagram```mermaid\ngraph TD A-->B ``` That concludes the diagram section.";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^## Flow Diagram$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toContain("That concludes the diagram section.");
    // trailing prose must be OUTSIDE the code block
    const block = (out.match(/```mermaid[\s\S]*?```/g) ?? [])[0] ?? "";
    expect(block).not.toContain("That concludes");
  });

  it("does not reconstruct when heading trailing fence has no following paragraph", () => {
    const input = "## Heading```mermaid\n\n## Another Heading";
    const out = runPlugin(input, remarkFixInlineFences);
    // No paragraph body follows, so the heading is left untouched (no code block created)
    expect(out).not.toMatch(/^```mermaid$/m);
  });

  it("reconstructs heading-glued fence when the heading has inline formatting before the fence", () => {
    const input = "## **Title**```mermaid\ngraph TD\nA-->B";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toMatch(/^## \*\*Title\*\*$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
  });
});

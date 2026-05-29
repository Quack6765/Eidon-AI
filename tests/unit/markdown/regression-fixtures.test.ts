// tests/unit/markdown/regression-fixtures.test.ts
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import { MARKDOWN_REMARK_PLUGINS } from "@/lib/markdown/plugins";

function render(input: string): string {
  const proc = unified().use(remarkParse).use(remarkGfm);
  for (const plugin of MARKDOWN_REMARK_PLUGINS) proc.use(plugin as never);
  return proc
    .use(remarkStringify, { bullet: "-", listItemIndent: "one" })
    .processSync(input)
    .toString()
    .trimEnd();
}

describe("regression fixtures from production screenshots", () => {
  it("fixture: PlayStation inline-code split across newline", () => {
    const input = "- PlayStation: `L1\n  - R1`";
    const out = render(input);
    expect(out).toContain("`L1/R1`");
    expect(out).not.toMatch(/-\s+R1`/);
  });

  it("fixture: bold spans paragraph + list boundary", () => {
    const input = "The **USB cable\n\n- PowerPanel software** approach";
    const out = render(input);
    expect(out).toMatch(/\*\*USB cable\*\*/);
    expect(out).toMatch(/\*\*PowerPanel software\*\*/);
  });

  it("fixture: collapsed transfer-time table", () => {
    const input =
      "| Transfer Time | Runtime | |---|---| | What it is | gap | | Duration | 4-8 ms |";
    const out = render(input);
    expect(out).toContain("| Transfer Time");
    expect(out).toContain("| 4-8 ms");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(3);
  });

  it("fixture: SLA-replacement table with strikethrough cells", () => {
    const input =
      "5. **Cost-Benefit Doesn't Add Up**\n\n" +
      "| Lead-acid | LiFePO₄ | |---|---| | $40-60 | $80-120 |";
    const out = render(input);
    expect(out).toContain("|");
    expect(out).toContain("$40-60");
  });

  it("fixture: ordered list with broken numbering (1, 2, 7, 2)", () => {
    const input = "1. First\n\nprose\n\n7. Third\n\n2. Fourth";
    const out = render(input);
    // After renumber + merge, ideally one sequence 1, 2, 3, 4.
    const numbers = (out.match(/^\d+\./gm) || []).map((s) => s.replace(/\./, ""));
    expect(numbers[0]).toBe("1");
  });

  it("fixture: extra blank lines between bullet items (loose -> tight)", () => {
    const input =
      "- Level 1\n\n  - Level 2\n\n    - Level 3\n\n      - Level 4\n\n- Another Level 1";
    const out = render(input);
    // Most adjacent items at the same level should NOT have a blank line between them.
    expect(out.split("\n\n").length).toBeLessThan(6);
  });

  it("fixture: mixed emphasis markers leak literal **", () => {
    const input = "- **_Bold and Italic_** combined";
    const out = render(input);
    expect(out).toContain("Bold and Italic");
  });

  it("fixture: sentence split across two bullets ending in 'range.'", () => {
    const input =
      "- 8 more Gym Badges — challenge all 8 Kanto Gym Leaders with teams in the level 40-60\n- range.";
    const out = render(input);
    expect(out).toContain("40-60 range.");
    expect(out.split("\n").filter((l) => l.trim().startsWith("- ")).length).toBe(1);
  });

  it("fixture: API endpoints table with inline code in cells", () => {
    const input =
      "| Endpoint | Method | Description | Status | |---|---|---|---| | `/api/v1/vessels` | GET | Retrieve all active vessels | Active | | `/api/v1/vessels/{id}` | GET | Get vessel details | Active |";
    const out = render(input);
    expect(out).toContain("| Endpoint");
    expect(out).toContain("api/v1/vessels");
    expect(out).toContain("api/v1/vessels/{id}");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(3);
  });

  it("fixture: inline ` * ` list markers across sub-bullet text", () => {
    const input =
      "- Active Vessels\n  - Cargo haulers * Class-A heavy freighters * Sub-type: Deep space variants * Capacity: 50,000";
    const out = render(input);
    expect(out).toContain("- Cargo haulers");
    expect(out).toContain("- Class-A heavy freighters");
    expect(out).toContain("- Sub-type: Deep space variants");
  });

  it("fixture: thematic break glued to end of heading", () => {
    const input = "# Annual Fantasy Realm Census Report 2026---\n## Executive Summary\nBody text";
    const out = render(input);
    expect(out).toContain("# Annual Fantasy Realm Census Report 2026");
    expect(out).not.toMatch(/2026-{3}/);
    expect(out).toContain("***");
    expect(out).toContain("## Executive Summary");
  });

  it("fixture: thematic break glued to end of paragraph", () => {
    const input = "Some paragraph ending in marker---\n\nNext paragraph";
    const out = render(input);
    expect(out).toContain("Some paragraph ending in marker");
    expect(out).toContain("***");
    expect(out).toContain("Next paragraph");
  });

  it("fixture: inline markdown preserved when split by ` * ` markers", () => {
    const input =
      "- A dragon warding system rated `Grade-A` or higher * Current count: `2` * **City** (50,000 residents)";
    const out = render(input);
    expect(out).toMatch(/`Grade-A`/);
    expect(out).toMatch(/`2`/);
    expect(out).toMatch(/\*\*City\*\*/);
    expect(out).not.toMatch(/`Grade-A\\`/);
  });

  it("fixture: inline markdown preserved when split by inline thematic break", () => {
    const input = "Some `code` ending---**Next** paragraph with `more code`";
    const out = render(input);
    expect(out).toMatch(/`code`/);
    expect(out).toMatch(/\*\*Next\*\*/);
    expect(out).toMatch(/`more code`/);
    expect(out).toContain("***");
  });

  it("fixture: leading --- glued to ## heading at line start", () => {
    const input = "---## Troubleshooting\n\n### Common Issues";
    const out = render(input);
    expect(out).toContain("***");
    expect(out).toContain("## Troubleshooting");
    expect(out).toContain("### Common Issues");
    expect(out).not.toMatch(/---##/);
  });

  it("fixture: single `* Capital` marker after glued asterisk", () => {
    const input =
      "- Contact support at <support@summitos.fake>* Network unreachable";
    const out = render(input);
    expect(out.split("\n").filter((l) => l.trim().startsWith("- ")).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain("Network unreachable");
  });

  it("fixture: ### heading marker after inline code in paragraph", () => {
    const input = "Verify DNS settings in `/etc/summit/network.conf` ### Known Limitations";
    const out = render(input);
    expect(out).toContain("`/etc/summit/network.conf`");
    expect(out).toMatch(/^### Known Limitations/m);
  });

  it("fixture: multi-word title with capital words is not split by heading-from-text heuristic", () => {
    const input = 'Roadmap### Q3 2026 — "Horizon" Release\n\nNext paragraph';
    const out = render(input);
    expect(out).toMatch(/### Q3 2026.*Horizon.*Release/);
    expect(out).not.toMatch(/### Q3 2026 — "Horizon"\n\nRelease/);
  });

  it("fixture: nested ### inside an existing heading promotes a sub-heading", () => {
    const input = "## API Reference### Authentication Endpoint";
    const out = render(input);
    expect(out).toMatch(/^## API Reference/m);
    expect(out).toMatch(/^### Authentication Endpoint/m);
  });

  it("fixture: --- glued after a period at end of a blockquote paragraph", () => {
    const input = "> **Note:** This is a fictional project document. All data is made up.---\n\nNext block";
    const out = render(input);
    expect(out).toContain("made up.");
    expect(out).not.toMatch(/made up\.-{3}/);
    expect(out).toContain("***");
    expect(out).toContain("Next block");
  });

  it("fixture: heading with glued inline list markers (Key Features* item* item)", () => {
    const input =
      "### Key Features* High Performance: Processes up to ~~1 million~~ 5 million events per second* Scalability: Horizontally scales from 1 to 10,000 nodes";
    const out = render(input);
    expect(out).toMatch(/^### Key Features\s*$/m);
    expect(out).toMatch(/^- High Performance/m);
    expect(out).toMatch(/^- Scalability/m);
    expect(out).toContain("~~1 million~~");
  });

  it("fixture: bold label glued to inline list markers (**Key Features*** item* item)", () => {
    const input =
      "**Key Features*** High Performance: Processes up to ~~1 million~~ 5 million events per second* Scalability: Horizontally scales from 1 to 10,000 nodes";
    const out = render(input);
    expect(out).toMatch(/\*\*Key Features\*\*/);
    expect(out).toMatch(/^- High Performance/m);
    expect(out).toMatch(/^- Scalability/m);
    expect(out).toContain("~~1 million~~");
  });

  it("fixture: ordered list item label with inline numbered sub-items (Ingestion Layer)", () => {
    const input =
      "1. **Ingestion Layer** 1. Raw data arrives via multiple channels 2. Schema validation occurs";
    const out = render(input);
    expect(out).toMatch(/\*\*Ingestion Layer\*\*/);
    expect(out).toMatch(/Raw data arrives via multiple channels/);
    expect(out).toMatch(/Schema validation occurs/);
    expect(out.split("\n").filter((l) => /^\s+\d+\.\s/.test(l)).length).toBeGreaterThanOrEqual(2);
  });

  it("fixture: bold label glued to ordered list (no space) — Processing Layer", () => {
    const input =
      "**Processing Layer**1. Stream processors handle real-time data 2. Batch processors run scheduled jobs";
    const out = render(input);
    expect(out).toMatch(/\*\*Processing Layer\*\*/);
    expect(out).toMatch(/^1\.\s+Stream processors handle real-time data$/m);
    expect(out).toMatch(/^2\.\s+Batch processors run scheduled jobs$/m);
  });

  it("fixture: bold label + inline ordered markers — Storage Layer", () => {
    const input =
      "**Storage Layer** 1. Hot storage (Redis cache) 2. Warm storage (PostgreSQL) 3. Cold storage (S3 Glacier)";
    const out = render(input);
    expect(out).toMatch(/\*\*Storage Layer\*\*/);
    expect(out).toMatch(/^1\.\s+Hot storage \(Redis cache\)$/m);
    expect(out).toMatch(/^2\.\s+Warm storage \(PostgreSQL\)$/m);
    expect(out).toMatch(/^3\.\s+Cold storage \(S3 Glacier\)$/m);
  });

  it("fixture: Table of Contents heading glued to ordered markers without space", () => {
    const input =
      "## Table of Contents1. Architecture 2. Getting Started 3. API Reference 4. Contributing";
    const out = render(input);
    expect(out).toMatch(/^## Table of Contents\s*$/m);
    expect(out).toMatch(/^1\.\s+Architecture$/m);
    expect(out).toMatch(/^4\.\s+Contributing$/m);
  });

  it("fixture: heading word glued to prose paragraph via camelCase boundary", () => {
    const input =
      "## OverviewWelcome to the official documentation for *Project Nebula* — our next-generation platform";
    const out = render(input);
    expect(out).toMatch(/^## Overview\s*$/m);
    expect(out).toMatch(/^Welcome to the official documentation/m);
    expect(out).toContain("*Project Nebula*");
  });

  it("fixture: 4-column table with || row delimiter reconstructs without thematic-break interference", () => {
    const input =
      "| Header 1 | Header 2 | Header 3 | Header 4 ||---------|---------|---------|---------| | Cell 1A | Cell 2A | Cell3A | Cell 4A || Cell 1B | Cell 2B | Cell 3B | Cell4B || Cell 1C | Cell 2C | Cell 3C | Cell4C |";
    const out = render(input);
    expect(out).not.toContain("***");
    expect(out).toContain("| Header 1");
    expect(out).toContain("Cell 1A");
    expect(out).toContain("Cell4C");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(5);
  });

  it("fixture: complex table with emojis + nested markdown stays intact", () => {
    const input =
      "| Feature | Status | Notes ||---------|--------|-------| | Authentication | ✅ Done | Implemented OAuth 2.0 || Database | 🔄 In Progress | *Optimization phase* |";
    const out = render(input);
    expect(out).not.toContain("***");
    expect(out).toContain("Authentication");
    expect(out).toContain("✅ Done");
    expect(out).toContain("🔄 In Progress");
    expect(out).toMatch(/\*Optimization phase\*/);
  });

  it("fixture: alignment table with :--- separators reconstructs without thematic-break interference", () => {
    const input =
      "| Left Aligned | Center Aligned | Right Aligned | No Alignment ||:-------------|:--------------:|--------------:|--------------| | Left 1 | Center1 | Right 1 | Normal 1 || Left 2 | Center 2 | Right 2 | Normal 2 |";
    const out = render(input);
    expect(out).not.toContain("***");
    expect(out).toContain("Left Aligned");
    expect(out).toContain("Center Aligned");
    expect(out).toContain("Left 1");
    expect(out).toContain("Center 2");
  });

  it("fixture: Database Schema Reference table with trailing |--- artifact", () => {
    const input =
      "| Field | Type | Constraints | Description ||-------|-------|------------|--------------| | user_id | UUID | PRIMARY KEY | Unique identifier || email | VARCHAR(255) | UNIQUE, NOT NULL | User email address || created_at | TIMESTAMP | DEFAULT NOW() | Account creation date || status | ENUM | DEFAULT 'active' | Account status |---";
    const out = render(input);
    expect(out).toContain("| Field");
    expect(out).toMatch(/user\\?_id/);
    expect(out).toContain("email");
    expect(out).toMatch(/created\\?_at/);
    expect(out).toContain("status");
    expect(out).toContain("Account status");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(6);
  });

  it("fixture: blockquote with inline > and > > markers splits into nested structure", () => {
    const input =
      "> *Warning: The legacy authentication system will be deprecated on January 15, 2026.*> > *Additional Context: Teams using the old JWT-based system should prioritize the migration.*> *Historical Note: The legacy system was originally implemented in Q2 2023 as a temporary solution.*";
    const out = render(input);
    expect(out).toMatch(/^>\s+\*Warning:/m);
    expect(out).toMatch(/^>\s+>\s+\*Additional Context:/m);
    expect(out).toMatch(/^>\s+\*Historical Note:/m);
  });

  it("fixture: API table followed by glued #### multi-word heading + prose", () => {
    const input =
      "| Method | Endpoint | Description | Rate Limit ||--------|---------|------------|------------|| `GET` | `/api/v4/projects` | List all projects | 1000/hr || `POST` | `/api/v4/projects` | Create a new project | 100/hr |#### Response FormatSuccessful responses return JSON in this structure:";
    const out = render(input);
    expect(out).toContain("| Method");
    expect(out).toMatch(/`GET`/);
    expect(out).toMatch(/^#### Response Format\s*$/m);
    expect(out).toMatch(/^Successful responses return JSON in this structure:/m);
  });

  it("fixture: deployment checklist with inline task-list markers glued together", () => {
    const input =
      "- [x] Infrastructure provisioning completed\n- [x] DNS records configured\n- [ ] Database migrations applied- [ ] Load tests passed - [ ] < 200ms p95 latency";
    const out = render(input);
    expect(out).toMatch(/Database migrations applied/);
    expect(out).toMatch(/Load tests passed/);
    expect(out).toMatch(/< 200ms p95 latency/);
    expect(out.split("\n").filter((l) => /^[-*]\s+\[/.test(l)).length).toBeGreaterThanOrEqual(5);
  });

  it("fixture: nested ordered list with all sub-items glued inline in the first sub-item", () => {
    const input =
      "1. First main step\n2. Second main step\n   1. Sub-step 2.1 2. Sub-step 2.2 1. Sub-sub-step 2.2.a 2. Sub-sub-step 2.2.b 1. Sub-sub-sub-step 2.2.b.i3. Sub-step 2.3\n3. Third main step\n   1. Sub-step 3.11. Deep sub-step 3.1.a 1. Very deep 3.1.a.i\n4. Fourth main step";
    const out = render(input);
    expect(out).toContain("Sub-step 2.1");
    expect(out).toContain("Sub-step 2.2");
    expect(out).toContain("Sub-sub-step 2.2.a");
    expect(out).toContain("Sub-sub-step 2.2.b");
    expect(out).toContain("Sub-sub-sub-step 2.2.b.i");
    expect(out).toContain("Sub-step 2.3");
    expect(out).toContain("Sub-step 3.1");
    expect(out).toContain("Deep sub-step 3.1.a");
    expect(out).toContain("Very deep 3.1.a.i");
    expect(out).toContain("Fourth main step");
  });

  it("fixture: bash deploy script with comment line + glued env vars + echo", () => {
    const input =
      "```bash#!/bin/bash\n# Deploy script for Project Atlasset -euo pipefailENVIRONMENT=\"${1:-staging}\"VERSION=\"${2:-latest}\"echo \"Deploying Atlas v${VERSION} to ${ENVIRONMENT}\"\nkubectl apply -f ./manifests/${ENVIRONMENT}/\nkubectl rollout status deployment/atlas-api -n ${ENVIRONMENT}\n\necho \"Deployment complete!\"\n```";
    const out = render(input);
    expect(out).toMatch(/^#!\/bin\/bash$/m);
    expect(out).toMatch(/^# Deploy script for Project Atlas$/m);
    expect(out).toMatch(/^set -euo pipefail$/m);
    expect(out).toMatch(/^ENVIRONMENT="\$\{1:-staging\}"$/m);
    expect(out).toMatch(/^VERSION="\$\{2:-latest\}"$/m);
    expect(out).toMatch(/^echo "Deploying Atlas v/m);
  });

  it("fixture: multi-word heading with glued prose paragraph (Executive Summary)", () => {
    const input =
      "## Executive SummaryThis document outlines the specifications for Project Nebula, a next-generation quantum computing dashboard.";
    const out = render(input);
    expect(out).toMatch(/^## Executive Summary\s*$/m);
    expect(out).toMatch(/^This document outlines the specifications for Project Nebula/m);
  });

  it("fixture: typescriptinterface code block with glued meta+content (4.2 Error Rates)", () => {
    const input =
      "```typescriptinterface ErrorBudget {  service: string;  allowedErrors: number;  actualErrors: number;\n  remaining: number;\n}\n\nconst budget: ErrorBudget = {\n  service: \"atlas-api\",\n  allowedErrors:43200,\n  actualErrors: 12847, remaining: 30353,\n};\n```";
    const out = render(input);
    expect(out).toMatch(/```typescript\n/);
    expect(out).toContain("interface ErrorBudget {");
    expect(out).toContain("service: string;");
    expect(out).toContain("remaining: number;");
    expect(out).toContain("const budget: ErrorBudget = {");
    expect(out).toContain('service: "atlas-api"');
  });

  it("fixture: truncated table after blockquote renders header even with no data rows", () => {
    const input =
      "> Cross-functional teams deliver 40% faster than siloed departments.\n\n| Squad | Focus | Lead | Members | |---|---";
    const out = render(input);
    expect(out).toContain("Cross-functional teams");
    expect(out).toMatch(/\|\s*Squad\s*\|/);
    expect(out).toMatch(/\|\s*Members\s*\|/);
  });

  it("fixture: mermaid code block recovered when heading glued to opening fence", () => {
    const input =
      "### Architecture Overview```mermaid\ngraph TD\nA[Client] --> B[Load Balancer]\nB --> C[Web Tier]\nC --> D[API Gateway]\n```";
    const out = render(input);
    expect(out).toMatch(/^### Architecture Overview\s*$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toContain("A[Client] --> B[Load Balancer]");
    expect(out).toContain("C --> D[API Gateway]");
  });

  it("fixture: paragraph glued to opening mermaid fence with orphan closer recovers code block", () => {
    const input =
      "## System Architecture\nThe following diagram illustrates our current system architecture:```mermaid\ngraph TD\nClient[Web/Mobile Client] --> CDN[CDN CloudFront]\nCDN --> LB[Load Balancer]\nLB --> API[API Gateway]\n```";
    const out = render(input);
    expect(out).toMatch(/^## System Architecture$/m);
    expect(out).toContain("The following diagram illustrates our current system architecture");
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toContain("Client[Web/Mobile Client] --> CDN[CDN CloudFront]");
    expect(out).toContain("LB --> API[API Gateway]");
  });

  it("fixture: Nebula configuration paragraph glued to precedence table", () => {
    const input =
      "Nebula uses a hierarchical configuration system. Settings are loaded in the following order of precedence | Priority | Source | Example ||---------|---------|---------| | 1 | Default values | `config/defaults.yaml` | | 2 | Environment file | `.env` | | 3 | Environment vars | `NEBULA_PORT=4000` | | 4 | CLI flags | `--port 4000` |";
    const out = render(input);
    expect(out).toContain("Nebula uses a hierarchical configuration system");
    expect(out).toContain("order of precedence");
    expect(out).toMatch(/\|\s*Priority\s*\|\s*Source\s*\|/);
    expect(out).toMatch(/\|\s*1\s*\|\s*Default values/);
    expect(out).toMatch(/\|\s*4\s*\|\s*CLI flags/);
  });

  it("fixture: mermaid block with hex color values does not get shredded by # heuristic", () => {
    const input =
      "### Project Roadmap Visualization```mermaid\ngraph TD A[Q1] --> B[Q2] style A fill:#e1f5fe style G fill:#c8e6c9 style D fill:#ffcdd2\n```";
    const out = render(input);
    expect(out).toMatch(/^### Project Roadmap Visualization\s*$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("graph TD");
    expect(out).toContain("style A fill:#e1f5fe");
    expect(out).toContain("style G fill:#c8e6c9");
    expect(out).toContain("style D fill:#ffcdd2");
    expect(out.split("\n").filter((l) => l.startsWith("#")).length).toBeLessThanOrEqual(1);
  });

  it("fixture: code block with Title-case lang 'Company' is not stripped to single letter", () => {
    const input =
      "```Company Organization\n├── Engineering\n│ ├── Frontend Team\n│ └── Backend Team\n├── Sales\n```";
    const out = render(input);
    expect(out).not.toMatch(/^```c$/m);
    expect(out).toContain("Company");
    expect(out).toContain("Engineering");
  });

  it("fixture: heading with glued table header + separator/rows on next line", () => {
    const input =
      "### Basic Table| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------| | Cell 1.1 | Cell 1.2 | Cell 1.3 | | Cell 2.1 | Cell 2.2 | Cell 2.3 | | Cell 3.1 | Cell 3.2 | Cell 3.3 |";
    const out = render(input);
    expect(out).toMatch(/^### Basic Table\s*$/m);
    expect(out).toMatch(/\|\s*Header 1\s*\|\s*Header 2\s*\|\s*Header 3\s*\|/);
    expect(out).toMatch(/\|\s*Cell 1\.1\s*\|/);
    expect(out).toMatch(/\|\s*Cell 3\.3\s*\|/);
  });

  it("fixture: Code Blocks heading glued to ### sub-heading splits cleanly", () => {
    const input = "## Code Blocks### Python Example\n\nbody text";
    const out = render(input);
    expect(out).toMatch(/^## Code Blocks$/m);
    expect(out).toMatch(/^### Python Example$/m);
  });

  it("fixture: glued mermaid lang (mermaidgraph TD...) reconstructs as mermaid code block", () => {
    const input =
      "## Architecture Overview\n\n```mermaidgraph TD A[Client] --> B[Server]\nstyle A fill:#e1f5\n```";
    const out = render(input);
    expect(out).toMatch(/^## Architecture Overview$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("A[Client] --> B[Server]");
    expect(out).toContain("style A fill:#e1f5");
  });

  it("fixture: paragraph 'mermaidgraph TD...' with orphan closer recovers mermaid code block", () => {
    const input =
      "## Architecture Overview\n\nmermaidgraph TD A[Client] --> B[Server]\nstyle A fill:#e1f5\n```";
    const out = render(input);
    expect(out).toMatch(/^## Architecture Overview$/m);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toContain("A[Client] --> B[Server]");
    expect(out).toContain("style A fill:#e1f5");
  });

  it("fixture: heading glued to json fence with trailing closing fence in body", () => {
    const input =
      '### API Response Example```json\n{ "status": "success", "data": { "user_id": "usr_8f7d6e5c4b3a", "plan": "enterprise" }, "timestamp": "2026-05-28T13:37:00Z" }```';
    const out = render(input);
    expect(out).toMatch(/^### API Response Example\s*$/m);
    expect(out).toMatch(/^```json$/m);
    expect(out).toContain('"user_id": "usr_8f7d6e5c4b3a"');
    expect(out).toContain('"timestamp": "2026-05-28T13:37:00Z"');
    expect(out).not.toMatch(/Z" \}```/);
  });

  it("fixture: mermaid diagram with all statements glued on one line is split into multiple lines", () => {
    const input =
      "```mermaid\ngraph TD A[Client] --> B[CloudFront CDN] CDN --> LB[Load Balancer] LB --> API[API Gateway]\nstyle A fill:#e1f5fe\n```";
    const out = render(input);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toMatch(/A\[Client\] --> B\[CloudFront CDN\]/);
    expect(out).toMatch(/CDN --> LB\[Load Balancer\]/);
    expect(out).toMatch(/LB --> API\[API Gateway\]/);
    expect(out).toContain("style A fill:#e1f5fe");
  });

  it("fixture: sequenceDiagram with glued participants, arrows, alt/else/end produces valid mermaid", () => {
    const input =
      "```mermaid\nsequenceDiagram    participant User    participant LB as Load Balancer\n    participant GW as API Gateway\n\n    User->>LB: HTTPS Request\n    LB->>GW: Route to Gateway    GW->>Auth: Validate JWT Token Auth-->>GW: Token Valid / Invalid\n    alt Valid Token\n        GW->>MS: Forward Request\n        LB-->>User: 200 OK else Invalid Token\n        GW-->>User:401 Unauthorized    end\n```";
    const out = render(input);
    expect(out).toMatch(/^```mermaid$/m);
    expect(out).toMatch(/^sequenceDiagram$/m);
    expect(out).toMatch(/^\s*participant User$/m);
    expect(out).toMatch(/^\s*participant LB as Load Balancer$/m);
    expect(out).toMatch(/^\s*participant GW as API Gateway$/m);
    expect(out).toMatch(/^\s*LB->>GW: Route to Gateway$/m);
    expect(out).toMatch(/^\s*GW->>Auth: Validate JWT Token$/m);
    expect(out).toMatch(/^\s*Auth-->>GW: Token Valid \/ Invalid$/m);
    expect(out).toMatch(/^\s*alt Valid Token$/m);
    expect(out).toMatch(/^\s*LB-->>User: 200 OK$/m);
    expect(out).toMatch(/^\s*else Invalid Token$/m);
    expect(out).toMatch(/^\s*GW-->>User: 401 Unauthorized$/m);
    expect(out).toMatch(/^end$/m);
  });

  it("fixture: code block closer glued to last code line, swallowing rest of response", () => {
    const input =
      "```yaml\nserver:\n  port: 8443\n  - user:email```\n\n### API Endpoint Documentation\n\n| Parameter | Type |\n|---|---|\n| grant_type | string |";
    const out = render(input);
    expect(out).toContain("### API Endpoint Documentation");
    expect(out).toContain("| Parameter");
    expect(out).toMatch(/grant\\?_type/);
    expect(out).toMatch(/```yaml[\s\S]*?```/);
  });

  it("fixture: malformed checkbox '[x ]' renders as a real checked task item", () => {
    const input =
      "- [x] Database migrations applied\n- [x ] DNS records configured\n- [ ] Load balancer health checks passing";
    const out = render(input);
    expect(out).toMatch(/^[-*]\s+\[x\]\s+DNS records configured$/m);
    expect(out).not.toContain("[x ]");
  });

  it("fixture: glued single sub-marker in deployment steps nests instead of running inline", () => {
    const input =
      "1. Clone the repository\n2. Install dependencies   1. Run the package manager:\n3. Configure environment";
    const out = render(input);
    expect(out).not.toContain("Install dependencies   1.");
    expect(out).toMatch(/^\s+\d+\.\s+Run the package manager:$/m);
  });
});

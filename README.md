<a name="readme-top"></a>

<div align="center">
  <img src="./public/eidon-banner.png" alt="Eidon" width="100%" />
  <br />
  <img src="./.github/readme/eidon-wordmark.svg" alt="Eidon" width="420" />

  <p>
    <strong>A self-hosted AI workspace you actually own.</strong><br />
    Bring your own model provider. One Docker image. Your data stays on your disk.
  </p>

  <p>
    <a href="#quick-start"><b>Quick start</b></a>
    ·
    <a href="#chat-that-shows-its-work"><b>Features</b></a>
    ·
    <a href="#bring-your-own-provider"><b>Providers</b></a>
    ·
    <a href="./docs/configuration.md"><b>Configuration</b></a>
    ·
    <a href="#documentation"><b>Docs</b></a>
  </p>

  <p>
    <a href="https://github.com/Quack6765/Eidon-AI/actions/workflows/test.yml"><img alt="Tests" src="https://img.shields.io/github/actions/workflow/status/Quack6765/Eidon-AI/test.yml?branch=main&label=tests&style=flat-square&labelColor=0a0a0a&color=8b5cf6" /></a>
    <a href="https://github.com/Quack6765/Eidon-AI/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Quack6765/Eidon-AI?style=flat-square&labelColor=0a0a0a&color=8b5cf6" /></a>
    <a href="https://github.com/Quack6765/Eidon-AI/pkgs/container/eidon-ai"><img alt="Container image" src="https://img.shields.io/badge/ghcr.io-eidon--ai-8b5cf6?style=flat-square&labelColor=0a0a0a&logo=docker&logoColor=white" /></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-8b5cf6?style=flat-square&labelColor=0a0a0a" /></a>
    <img alt="PWA" src="https://img.shields.io/badge/PWA-installable-8b5cf6?style=flat-square&labelColor=0a0a0a" />
  </p>

  <img src="./.github/readme/hero.png" alt="Eidon chat, agents, and automations" width="100%" />
</div>

Eidon is a self-hostable AI assistant workspace that runs as a single Docker image and
stores everything in SQLite on a volume you control. You connect the model providers you
already pay for instead of renting a seat on someone else's platform.

It is three places to work: **Chat** for everyday conversations, **Agents** for a team of
persistent bots that message each other, and **Automations** for work that should run on a
schedule without you.

> [!NOTE]
> Self-hosting is real work. You run the container, keep it updated, and own your backups.
> Eidon does not ship an API key — you bring the model access you want to use.

## Quick start

```bash
export EIDON_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export EIDON_SESSION_SECRET="$(openssl rand -hex 32)"
export EIDON_ENCRYPTION_SECRET="$(openssl rand -hex 32)"

docker run -d --name eidon --restart unless-stopped \
  -p 3000:3000 -v eidon-data:/app/data \
  -e EIDON_PASSWORD_LOGIN_ENABLED=true \
  -e EIDON_ADMIN_USERNAME=admin \
  -e EIDON_ADMIN_PASSWORD="$EIDON_ADMIN_PASSWORD" \
  -e EIDON_SESSION_SECRET="$EIDON_SESSION_SECRET" \
  -e EIDON_ENCRYPTION_SECRET="$EIDON_ENCRYPTION_SECRET" \
  ghcr.io/quack6765/eidon-ai
```

Open your Eidon URL, sign in, go to **Settings → Providers**, add a key, and start chatting.

<details>
<summary><kbd>Docker Compose</kbd></summary>

```yaml
services:
  eidon:
    image: ghcr.io/quack6765/eidon-ai
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      EIDON_PASSWORD_LOGIN_ENABLED: "true"
      EIDON_ADMIN_USERNAME: "admin"
      EIDON_ADMIN_PASSWORD: "${EIDON_ADMIN_PASSWORD}"
      EIDON_SESSION_SECRET: "${EIDON_SESSION_SECRET}"
      EIDON_ENCRYPTION_SECRET: "${EIDON_ENCRYPTION_SECRET}"
    volumes:
      - eidon-data:/app/data

volumes:
  eidon-data:
```

Keep `EIDON_ENCRYPTION_SECRET` stable across deployments — it decrypts your stored
provider keys and MCP tokens. Full reference in [Configuration](./docs/configuration.md).

</details>

## Chat that shows its work

Every turn is a visible timeline: which skill loaded, which tool ran, what it returned.
Nothing important happens off-screen.

<img src="./.github/readme/desktop-chat.png" alt="Eidon chat with a tool timeline, a memory proposal card, and queued follow-ups" width="100%" />

- **You approve what it remembers.** When the assistant wants to save a memory it proposes
  it — you save, edit, or ignore. Same flow for automations it wants to create.
- **Queue follow-ups while it works.** Reorder them, edit them, or send one next.
- **Fork from any reply** to branch a thread, or edit an earlier message and restart from there.
- **Context gauge and compaction** so long threads keep working instead of falling over.

## Agents that hand work to each other

The **Agents** area gives you a team of persistent bots. A Chief of Staff is created for
you: message it directly and it answers, delegates, or proposes a new specialist bot when a
job deserves a long-lived owner.

<img src="./.github/readme/desktop-delegation.png" alt="The Chief of Staff bot messaging two specialist bots" width="100%" />

Delegation is peer-to-peer — any bot can message any other bot, not just the chief. The
sender keeps working while the target runs in its own thread, and the reply comes back into
the conversation.

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-agents.png" alt="Bot roster with live status" />

<b>A roster with live status</b><br />
<sub>Each bot has its own thread, memory, avatar, and an isolated sandbox: its own file
workspace and its own browser session with its own logins.</sub>

</td>
<td width="50%">

<img src="./.github/readme/desktop-agent-proposal.png" alt="A bot proposing a scheduled automation" />

<b>Bots ask before they commit</b><br />
<sub>A bot that spots repeating work proposes an automation and waits. It shows as
<i>waiting for input</i> on the roster until you decide.</sub>

</td>
</tr>
</table>

## Deep research with a plan you control

Toggle **Deep research** and Eidon drafts a research plan before spending anything. Edit the
steps, reorder them, delete them, add your own — then start it.

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-research-plan.png" alt="An editable seven-step research plan" />

<b>Approve the plan first</b><br />
<sub>Up to 12 steps, each one editable. Regenerate it or cancel before any tool runs.</sub>

</td>
<td width="50%">

<img src="./.github/readme/desktop-research.png" alt="A cited research report with a comparison table" />

<b>Get a cited report back</b><br />
<sub>Multi-query search, full-page reads, corroboration across sources, and a report with
inline citations and a sources list.</sub>

</td>
</tr>
</table>

## Automations that run without you

Interval or calendar schedules, each with its own provider profile and persona. Every run is
a real transcript you can open and read like any other conversation.

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-automations.png" alt="Automation detail with run history" />

<b>Schedules and run history</b><br />
<sub>Run now, retry a failed run, or bind an automation to a bot so it runs as a routine in
that bot's thread.</sub>

</td>
<td width="50%">

<img src="./.github/readme/desktop-automation-run.png" alt="A scheduled run transcript with tool calls" />

<b>Every run is auditable</b><br />
<sub>The full timeline — searches, page reads, shell commands — not just the summary.</sub>

</td>
</tr>
</table>

## Memory, tools, and MCP

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-memories.png" alt="Memory settings with pinned memories" />

<b>Memory you can read and edit</b><br />
<sub>Browse, search, and pin memories so they always stay in the prompt. Semantic recall
indexes past messages and attachments locally.</sub>

</td>
<td width="50%">

<img src="./.github/readme/desktop-mcp.png" alt="MCP server configuration" />

<b>MCP over HTTP or stdio</b><br />
<sub>The image ships <code>uvx</code> and <code>npx</code>, so stdio servers work out of the
box. Remote servers can sign in with OAuth instead of pasted keys.</sub>

</td>
</tr>
</table>

Built in: web search across Exa, Tavily, or a self-hosted SearXNG · full-page reading ·
image generation · vision · shell commands · reusable skills · a bundled browser-automation
skill with Chromium. See [Features](./docs/features.md).

## Renders what the answer needs

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-mermaid.png" alt="A Mermaid diagram rendered in a conversation" />

<b>Mermaid diagrams</b>

</td>
<td width="50%">

<img src="./.github/readme/desktop-code.png" alt="A syntax-highlighted code block" />

<b>Code, and LaTeX math</b>

</td>
</tr>
</table>

## Bring your own provider

<p>
  <img alt="OpenAI" src="https://img.shields.io/badge/OpenAI-0a0a0a?style=flat-square" />
  <img alt="Anthropic" src="https://img.shields.io/badge/Anthropic-0a0a0a?style=flat-square&logo=anthropic&logoColor=white" />
  <img alt="OpenRouter" src="https://img.shields.io/badge/OpenRouter-0a0a0a?style=flat-square&logo=openrouter&logoColor=white" />
  <img alt="Ollama" src="https://img.shields.io/badge/Ollama-0a0a0a?style=flat-square&logo=ollama&logoColor=white" />
  <img alt="LM Studio" src="https://img.shields.io/badge/LM%20Studio-0a0a0a?style=flat-square&logo=lmstudio&logoColor=white" />
  <img alt="GitHub Copilot" src="https://img.shields.io/badge/GitHub%20Copilot-0a0a0a?style=flat-square&logo=githubcopilot&logoColor=white" />
  <img alt="Gemini" src="https://img.shields.io/badge/Gemini-0a0a0a?style=flat-square&logo=googlegemini&logoColor=white" />
  <img alt="OpenCode" src="https://img.shields.io/badge/OpenCode-0a0a0a?style=flat-square&logo=opencode&logoColor=white" />
  <img alt="Xiaomi" src="https://img.shields.io/badge/Xiaomi-0a0a0a?style=flat-square&logo=xiaomi&logoColor=white" />
  <img alt="MiniMax" src="https://img.shields.io/badge/MiniMax-0a0a0a?style=flat-square&logo=minimax&logoColor=white" />
  <img alt="Z.ai" src="https://img.shields.io/badge/Z.ai-0a0a0a?style=flat-square" />
  <img alt="Kimi" src="https://img.shields.io/badge/Kimi-0a0a0a?style=flat-square&logo=kimi&logoColor=white" />
  <img alt="Grok" src="https://img.shields.io/badge/Grok-0a0a0a?style=flat-square" />
  <img alt="Perplexity" src="https://img.shields.io/badge/Perplexity-0a0a0a?style=flat-square&logo=perplexity&logoColor=white" />
  <img alt="DeepSeek" src="https://img.shields.io/badge/DeepSeek-0a0a0a?style=flat-square&logo=deepseek&logoColor=white" />
  <img alt="NVIDIA" src="https://img.shields.io/badge/NVIDIA-0a0a0a?style=flat-square&logo=nvidia&logoColor=white" />
  <img alt="Alibaba" src="https://img.shields.io/badge/Alibaba-0a0a0a?style=flat-square&logo=alibabacloud&logoColor=white" />
  <img alt="Mistral" src="https://img.shields.io/badge/Mistral-0a0a0a?style=flat-square&logo=mistralai&logoColor=white" />
  <img alt="AWS" src="https://img.shields.io/badge/AWS-0a0a0a?style=flat-square" />
  <img alt="Azure" src="https://img.shields.io/badge/Azure-0a0a0a?style=flat-square" />
  <br />
  <img alt="Plus any OpenAI-compatible or Anthropic-compatible provider" src="https://img.shields.io/badge/%2B%20any%20OpenAI--compatible%20or%20Anthropic--compatible%20provider-8b5cf6?style=flat-square&labelColor=0a0a0a" />
</p>

Nine of these are one-click presets. The rest work because Eidon speaks the OpenAI and
Anthropic Messages APIs — point a profile at any compatible endpoint, including a local
Ollama or LM Studio. Keep several profiles side by side and switch per conversation, each
with its own reasoning effort, context limit, and vision routing. Credentials are encrypted
at rest.

<img src="./.github/readme/desktop-providers.png" alt="Multiple provider profiles configured side by side" width="100%" />

Setup for every provider, including the GitHub Copilot OAuth app, is in
[Providers](./docs/providers.md).

## Install it on your phone

Eidon is an installable PWA — add it to your home screen and it runs standalone, with
layouts built for a phone rather than a shrunken desktop.

<p align="center">
  <img src="./.github/readme/mobile-chat.png" alt="Eidon chat on a phone" width="31%" />
  <img src="./.github/readme/mobile-agents.png" alt="Bot roster on a phone" width="31%" />
  <img src="./.github/readme/mobile-settings.png" alt="Provider settings on a phone" width="31%" />
</p>

## Why self-host this

- **No per-seat subscription.** You pay your provider for tokens you actually use. A local
  model through Ollama costs nothing per message.
- **Your conversations sit on your disk**, in a SQLite file you can copy, grep, and back up.
- **Any model, and more than one.** Route reasoning, coding, and vision to different
  providers in the same workspace, and change your mind without redeploying.
- **It is a workspace, not a chat box.** Agents, schedules, memory, tools, MCP, and
  multi-user administration are built in rather than assembled.
- **No lock-in.** AGPL-3.0, one container, and a documented export path.

## Alternatives

Worth knowing about before you pick Eidon:

- **ChatGPT / Claude.ai** — the polish bar, and genuinely excellent. Use them if you do not
  care where your conversations live. Eidon exists for when you do.
- **[Open WebUI](https://github.com/open-webui/open-webui)** — the most established
  self-hosted chat UI, with a much larger plugin ecosystem. Eidon is lighter to run and
  leans harder on agents and scheduled work.
- **[LibreChat](https://github.com/danny-avila/LibreChat)** — closest in scope, with strong
  multi-provider support. Worth a look if you want a bigger community.
- **[Jan](https://github.com/menloresearch/jan)** — desktop-first and fully local. Pick Jan
  if you never want a server; pick Eidon if you want a shared, multi-user workspace.

## Documentation

| Guide | What is in it |
| --- | --- |
| [Configuration](./docs/configuration.md) | Environment variables, secrets, data storage, security notes, backup and restore |
| [Providers](./docs/providers.md) | All presets, per-profile settings, GitHub Copilot, web search, image generation, speech-to-text |
| [MCP and skills](./docs/mcp-and-skills.md) | Transports, OAuth sign-in, vision MCP, writing skills, the bundled browser skill |
| [Features](./docs/features.md) | The complete capability reference |
| [Development](./docs/development.md) | Local setup, scripts, tests, image channels, architecture, mobile API |

## License

[AGPL-3.0-only](./LICENSE).

## AI-assisted development

Eidon is developed in part with AI assistance. All code is reviewed before it is accepted.

<div align="right"><a href="#readme-top">Back to top ↑</a></div>

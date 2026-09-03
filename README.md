<a name="readme-top"></a>

<div align="center">
  <img src="./public/eidon-banner.png" alt="Eidon" width="100%" />
  <br />
  <img src="./.github/readme/eidon-wordmark.svg" alt="Eidon" width="420" />

  <p>
    <strong>Self-hosted AI chat, with agents and automations.</strong><br />
    One Docker image. Your own model keys. Your data stays on your server.
  </p>

  <p>
    <a href="#quick-start"><b>Quick start</b></a>
    ·
    <a href="#chat"><b>Features</b></a>
    ·
    <a href="#providers"><b>Providers</b></a>
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

  <table>
    <tr>
      <td width="33%" align="center">
        <a href="./.github/readme/desktop-chat.png"><img src="./.github/readme/desktop-chat.png" alt="Eidon chat" /></a>
        <br /><b>Chat</b>
      </td>
      <td width="33%" align="center">
        <a href="./.github/readme/desktop-delegation.png"><img src="./.github/readme/desktop-delegation.png" alt="Eidon agents" /></a>
        <br /><b>Agents</b>
      </td>
      <td width="33%" align="center">
        <a href="./.github/readme/desktop-automations.png"><img src="./.github/readme/desktop-automations.png" alt="Eidon automations" /></a>
        <br /><b>Automations</b>
      </td>
    </tr>
  </table>

  <sub>Click any screenshot to see it full size.</sub>
</div>

Eidon is a self-hosted AI assistant. It runs as one Docker image, keeps your data in a
single file on your server, and works with the model providers you already use.

Get your own AI platform for everything you need in a matter of minutes.

There are three parts: **Chat** for normal conversations, **Agents** for bots that do work
on their own (Grok Bot like), and **Automations** for tasks that run on a schedule.

## What you get

<table>
<tr>
<td valign="top" width="50%">

**Chat**

- Chat and conversation
- Persistent memory across conversations
- Personas
- Folders, chat search, and forking
- Read-only share links
- Temporary chats
- Chat attachments
- Voice input with post-processing cleanup
- Mermaid diagrams, syntax highlighting, and LaTeX math

</td>
<td valign="top" width="50%">

**Agents and automations**

- Agents, with cross-agent messaging (Grok Bot like)
- Per-agent memory, files, and browser session
- Deep research with an editable plan
- Scheduled automations, with full run history

</td>
</tr>
<tr>
<td valign="top" width="50%">

**Tools**

- MCP
- Skills
- Built-in web search
- Built-in browser
- Shell commands
- Image generation
- Vision support (Native, MCP or with a dedicated vision model)

</td>
<td valign="top" width="50%">

**Platform**

- Bring your own provider
- Multi-user, with admin and user roles
- Single Docker image, SQLite, encrypted credentials
- Installable PWA — native iOS app coming soon
- Live sync across devices

</td>
</tr>
</table>

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

Full reference in [Configuration](./docs/configuration.md).

</details>

## Chat

A normal chat for day-to-day questions and getting work done, with solid tools built in.

<img src="./.github/readme/desktop-chat.png" alt="Eidon chat with a tool timeline, a memory proposal card, and queued follow-ups" width="100%" />

- **Reliable multi-conversations memory** You can approve it, edit it, or ignore it.
- **Send follow-ups while it is still working.** They queue up in order.
- **Edit an older message** and carry on from there, or branch off any reply.
- **Auto compaction for long chats.** Older messages are condensed in the background, and
  Eidon tells you when it happens.
- **Attach any file**, paste images, or dictate instead of typing.

## Agents

Agents are bots that work together to achieve a goal. Each one has its own chat, its own memory, and its own
workspace. You start with a Chief of Staff — ask it for something and it either answers, passes
the job to another bot, or offers to create a new bot for it.

<img src="./.github/readme/desktop-delegation.png" alt="The Chief of Staff bot messaging two specialist bots" width="100%" />

Any bot can message any other bot. The one that asked keeps
working, and the answer comes back to it when the other bot is done.

A bot can also write its own skill for future use.

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-agents.png" alt="Bot roster with live status" />

<b>See what the crew is doing</b><br />
<sub>Each bot also gets its own browser, so it can navigate and stay logged in to sites on its own.</sub>

</td>
<td width="50%">

<img src="./.github/readme/desktop-agent-proposal.png" alt="A bot proposing a scheduled automation" />

<b>They ask first</b><br />
<sub>A bot that notices repeating work offers to schedule it, then waits for your answer.</sub>

</td>
</tr>
</table>

## Deep research

Turn on **Deep research** and Eidon writes a detailed plan before it starts it's search. Change the steps however
you want, then let it run.

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-research-plan.png" alt="An editable seven-step research plan" />

<b>You approve the plan</b><br />
<sub>Edit, reorder, or remove any step. Nothing runs until you say so.</sub>

</td>
<td width="50%">

<img src="./.github/readme/desktop-research.png" alt="A cited research report with a comparison table" />

<b>You get a report with sources</b><br />
<sub>It searches, reads the pages in full, and links everything it used.</sub>

</td>
</tr>
</table>

## Automations

Support for automations of tasks. Every couple of minutes, or at a set time each day or week.
Every run is saved as a chat you can open and read.

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-automations.png" alt="Automation detail with run history" />

<b>Every run is kept</b><br />
<sub>Run one now, retry one that failed, or review older runs.</sub>

</td>
<td width="50%">

<img src="./.github/readme/desktop-automation-run.png" alt="A scheduled run transcript with tool calls" />

<b>See what it did</b><br />
<sub>The whole run, step by step, not just the final answer.</sub>

</td>
</tr>
</table>

## Memory

Eidon picks up on things worth remembering — what you are working on, who is involved, how
you like your answers — and brings them back in later conversations without you repeating
yourself.

<img src="./.github/readme/desktop-memories.png" alt="Memory settings with pinned memories" width="100%" />

- It asks before saving anything, so nothing is stored behind your back.
- Search, edit, or delete anything it has remembered.
- Pin the things that are important and must be added to all chats at all time.

## Tools

Web search, reading web pages, image generation, looking at images, and running commands are
all built in. Add more with MCP (local or remote).

<img src="./.github/readme/desktop-mcp.png" alt="MCP server configuration" width="100%" />

Full list in [Features](./docs/features.md).

## Diagrams, code, and math

<table>
<tr>
<td width="50%">

<img src="./.github/readme/desktop-mermaid.png" alt="A Mermaid diagram rendered in a conversation" />

<b>Mermaid diagrams</b>

</td>
<td width="50%">

<img src="./.github/readme/desktop-code.png" alt="A syntax-highlighted code block" />

<b>Code and math</b>

</td>
</tr>
</table>

## Providers

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

Eidon supports most of the big providers out of the box, and you can bring any other
OpenAI- or Anthropic-compatible service you want — including Ollama or LM Studio running on
your own machine.

Set up as many as you like and switch between them in any chat. Your keys are encrypted.

<img src="./.github/readme/desktop-providers.png" alt="Multiple provider profiles configured side by side" width="100%" />

Setup for each one is in [Providers](./docs/providers.md).

## On your phone

Add Eidon to your home screen from the browser and it opens like a normal app. The layout is
built for a phone, not a shrunk-down desktop. A native iOS app is coming soon.

<p align="center">
  <img src="./.github/readme/mobile-chat.png" alt="Eidon chat on a phone" width="31%" />
  <img src="./.github/readme/mobile-agents.png" alt="Bot roster on a phone" width="31%" />
  <img src="./.github/readme/mobile-settings.png" alt="Provider settings on a phone" width="31%" />
</p>

## Why Eidon

One Docker container, running in minutes, and you have the whole thing: agents doing real
work, everyday chat, and automations on a schedule.

- **Start in minutes.** One container and one volume. Nothing else to wire together.
- **Everything in one place.** Agents, automations, memory, tools, and multiple users are all
  part of it.
- **Bring your own model.** No expensive per-person subscription, and nothing tying you to one
  company's ecosystem.
- **Your chats stay on your server**, in one file you can copy and back up.
- **Open source**, under AGPL-3.0.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Configuration](./docs/configuration.md) | Settings, secrets, where your data lives, backups |
| [Providers](./docs/providers.md) | Setting up each provider, web search, images, voice |
| [MCP and skills](./docs/mcp-and-skills.md) | Adding tools and writing your own skills |
| [Features](./docs/features.md) | Everything Eidon can do |
| [Development](./docs/development.md) | Running it locally and how it is built |

## License

[AGPL-3.0-only](./LICENSE).

## AI-assisted development

Eidon is built partly with AI help. Every change is reviewed before it goes in.

<div align="right"><a href="#readme-top">Back to top ↑</a></div>

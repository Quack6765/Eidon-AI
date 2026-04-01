# External Services

## Active Integrations
| Service | Purpose | Config |
|---------|---------|--------|
| OpenAI-compatible API | Chat inference, streaming, and compaction summarization | Stored in `app_settings` from `/settings` |
| Model Context Protocol (MCP) servers | External tool discovery and tool execution from chat | Stored in `mcp_servers` from `/settings` |

## OpenAI-compatible API
- **Endpoint:** User-configurable `apiBaseUrl`
- **Auth:** API key
- **Usage:** Main chat responses and memory compaction summarization in `lib/provider.ts`
- **Preset Shortcuts:** Settings can prefill Ollama Cloud (`https://ollama.com/v1`), Z.AI GLM Coding Plan (`https://api.z.ai/api/coding/paas/v4`), or a generic OpenAI-compatible default (`https://api.openai.com/v1`)
- **Reasoning Visibility:** Hermes requests visible reasoning for supported models; OpenAI reasoning models use Responses API summaries, while Z.AI `glm-5`/`glm-4.7` style models can surface thinking through `chat.completions` reasoning deltas
- **Text Normalization:** Provider deltas and final text normalize escaped newline sequences like `\\n` and `\\r\\n` into real line breaks before persistence and rendering
- **Error Handling:** Bubble provider failures back to the UI with explicit error messages; no silent fallback provider

## Model Context Protocol (MCP)
- **Client Implementation:** Hermes uses the official `@modelcontextprotocol/sdk` client for both `stdio` and `streamable_http` transports
- **Protocol Baseline:** Hermes advertises and tests against MCP protocol version `2025-03-26`
- **Tool Permissions:** In `Read-Only` mode, Hermes only exposes tools with `annotations.readOnlyHint === true`; unannotated tools are treated as non-read-only and hidden
- **Capability Inventory:** Before each assistant turn, Hermes merges a unified capability inventory into the primary system prompt so the model sees enabled skills, configured MCP servers, and currently executable MCP tools in one place
- **Capability Questions:** Direct "what tools / skills / MCP servers do you have?" questions are answered from Hermes' own runtime inventory instead of relying on the model to describe its environment from memory
- **Runtime Flow:** The assistant can emit `TOOL_CALL: {...}` control messages, Hermes executes the MCP tool itself, then injects the structured result back into the prompt loop before the final answer
- **Auto Tool Use:** Hermes can proactively trigger the best matching MCP tool on the first pass for obvious current-information and web-research requests before asking the model to answer
- **Connection Testing:** Settings-level MCP tests perform a real SDK initialize plus `listTools` request and show the discovered tool count inline

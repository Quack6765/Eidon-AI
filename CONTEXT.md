# Eidon AI

A self-hosted, multi-provider AI chat assistant. A single backend serves many LLM providers (OpenAI-compatible Chat Completions, OpenAI Responses, Anthropic Messages, GitHub Copilot) through one streaming conversation runtime.

## Language

### Conversation execution

**Turn**:
One user message producing one assistant response — a full `resolveAssistantTurn` invocation, which may loop over multiple steps before producing a final answer.
_Avoid_: Request, call, generation, run

**Step**:
One iteration of the tool loop inside a turn. A step is exactly one provider call, followed by executing any tool calls that step returned (if none, the turn ends).
_Avoid_: Round, iteration, hop

**Provider call**:
One invocation of the streaming provider function (`streamProviderResponse` / `callProviderText`) that talks to a single LLM API and yields answer, reasoning, and tool-call output. The smallest unit a retry can wrap.
_Avoid_: API request, inference

**Tool call**:
A structured function the model requests the runtime to execute (MCP tool, skill, memory op, image generation, shell, web search). Tools execute after a provider call completes, never while tokens are streaming.
_Avoid_: Function call, action

**Compaction**:
Summarizing older conversation history to fit the provider's context window before a turn runs.
_Avoid_: Summarization, truncation

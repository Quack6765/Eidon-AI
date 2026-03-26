# About

## What is this?
Hermes is a self-hosted single-user chat application for day-to-day assistant use from a browser. It provides a ChatGPT-style interface backed by a user-supplied OpenAI-compatible API, with local auth, persisted chat history, streaming answers, optional visible reasoning output, and automatic long-context compaction that keeps every raw message while summarizing older turns into recoverable memory nodes.

## Who is it for?
| User Type | Description |
|-----------|-------------|
| Personal operator | A single self-hosting user who wants a private browser chat UI with their own provider credentials |

## What can users do?
- Sign in with a local username and password
- Configure provider URL, API key, model, and context settings
- Start, revisit, and delete persisted conversations
- See assistant reasoning separately from final answers when the provider exposes it
- Continue long conversations while Hermes compacts older context automatically

## How it works (high-level)
The user signs in, configures the model backend, and opens a conversation from the sidebar. Each turn is stored in SQLite. Before a new model call, Hermes estimates the token budget, compacts older eligible turns into structured summary nodes if needed, rebuilds the prompt from summaries plus recent raw messages, and then streams the assistant response back into the browser with progressive reveal.

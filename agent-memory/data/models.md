# Models

## Entities
| Model | Description |
|-------|-------------|
| `admin_users` | Single local operator account |
| `auth_sessions` | Active signed login sessions |
| `app_settings` | Global app metadata, including the default provider profile id |
| `provider_profiles` | Saved full runtime presets, including connection, model, prompt, and context controls |
| `conversations` | Chat threads pinned to a provider profile |
| `messages` | Raw user, assistant, and system messages |
| `message_attachments` | Stored local attachment metadata for user messages and pending uploads |
| `memory_nodes` | Hierarchical compacted summaries |
| `compaction_events` | Visible compaction history and links |

## Relationships
- **`admin_users` → `auth_sessions`:** one-to-many
- **`provider_profiles` → `conversations`:** one-to-many
- **`conversations` → `messages`:** one-to-many
- **`conversations` → `message_attachments`:** one-to-many
- **`conversations` → `memory_nodes`:** one-to-many
- **`conversations` → `compaction_events`:** one-to-many
- **`messages` → `message_attachments`:** one-to-many after pending uploads are bound to the created user turn

## Key Fields
### `provider_profiles`
| Field | Type | Description |
|-------|------|-------------|
| `name` | `TEXT` | Human label shown in settings and the in-conversation selector |
| `api_base_url` | `TEXT` | Provider base URL for the OpenAI-compatible client |
| `api_key_encrypted` | `TEXT` | Encrypted stored credential for that profile |
| `model` / `api_mode` | `TEXT` | Runtime model choice and API mode for that preset |
| `system_prompt` ... `fresh_tail_count` | runtime settings | Full per-profile execution and compaction configuration |

### `conversations`
| Field | Type | Description |
|-------|------|-------------|
| `provider_profile_id` | `TEXT \| NULL` | Selected runtime preset for the thread; migrations backfill this to the default profile |
| `title` | `TEXT` | Sidebar/header label. New threads start as `Conversation`, attachment-only first turns resolve to `Files`, and explicit titles skip auto-generation |
| `title_generation_status` | `TEXT` | One-time auto-title lifecycle: `pending`, `running`, `completed`, or `failed` |

### `messages`
| Field | Type | Description |
|-------|------|-------------|
| `content` | `TEXT` | Final visible user/assistant text or system notice; provider system prompts stay in `provider_profiles.system_prompt` and are not shown in chat |
| `thinking_content` | `TEXT` | Visible reasoning stored separately from final answer |
| `compacted_at` | `TEXT \| NULL` | Marks raw turns already folded into memory nodes |

### `message_attachments`
| Field | Type | Description |
|-------|------|-------------|
| `conversation_id` / `message_id` | `TEXT` / `TEXT \| NULL` | Conversation ownership plus deferred binding to the eventual user message |
| `filename` / `mime_type` | `TEXT` | Sanitized original name and normalized content type |
| `byte_size` / `sha256` | `INTEGER` / `TEXT` | Stored file size and integrity hash |
| `relative_path` | `TEXT` | Path under `HERMES_DATA_DIR/attachments/<conversationId>/...` |
| `kind` | `TEXT` | `image` or `text` |
| `extracted_text` | `TEXT \| NULL` | Server-side extracted content for text-like files used during prompt assembly and compaction |

### `memory_nodes`
| Field | Type | Description |
|-------|------|-------------|
| `type` | `TEXT` | `leaf_summary` or `merged_summary` |
| `child_node_ids` | `TEXT` | JSON array of merged child node ids |
| `superseded_by_node_id` | `TEXT \| NULL` | Marks nodes replaced by a higher-level merged node |

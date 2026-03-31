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
| `memory_nodes` | Hierarchical compacted summaries |
| `compaction_events` | Visible compaction history and links |

## Relationships
- **`admin_users` → `auth_sessions`:** one-to-many
- **`provider_profiles` → `conversations`:** one-to-many
- **`conversations` → `messages`:** one-to-many
- **`conversations` → `memory_nodes`:** one-to-many
- **`conversations` → `compaction_events`:** one-to-many

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

### `messages`
| Field | Type | Description |
|-------|------|-------------|
| `content` | `TEXT` | Final visible user/assistant text or system notice |
| `thinking_content` | `TEXT` | Visible reasoning stored separately from final answer |
| `compacted_at` | `TEXT \| NULL` | Marks raw turns already folded into memory nodes |

### `memory_nodes`
| Field | Type | Description |
|-------|------|-------------|
| `type` | `TEXT` | `leaf_summary` or `merged_summary` |
| `child_node_ids` | `TEXT` | JSON array of merged child node ids |
| `superseded_by_node_id` | `TEXT \| NULL` | Marks nodes replaced by a higher-level merged node |

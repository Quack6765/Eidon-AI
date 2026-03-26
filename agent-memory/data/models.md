# Models

## Entities
| Model | Description |
|-------|-------------|
| `admin_users` | Single local operator account |
| `auth_sessions` | Active signed login sessions |
| `app_settings` | Provider and context settings |
| `conversations` | Chat threads |
| `messages` | Raw user, assistant, and system messages |
| `memory_nodes` | Hierarchical compacted summaries |
| `compaction_events` | Visible compaction history and links |

## Relationships
- **`admin_users` → `auth_sessions`:** one-to-many
- **`conversations` → `messages`:** one-to-many
- **`conversations` → `memory_nodes`:** one-to-many
- **`conversations` → `compaction_events`:** one-to-many

## Key Fields
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

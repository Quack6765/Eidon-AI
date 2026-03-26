# Testing

## Strategy
- **Approach:** [Test Pyramid / Testing Trophy / etc.]
- **Coverage Target (Default):** **≥ 85%** on new/changed code (prefer patch/new-code coverage; enforce branches/functions when available)

## Test Types
| Type | Location | Runner | Command |
|------|----------|--------|---------|
| Unit | `[path]` | [Framework] | `[command]` |
| Integration | `[path]` | [Framework] | `[command]` |
| E2E | `[path]` | [Framework] | `[command]` |

## Conventions
- **File Naming:** [e.g., *.test.ts, *.spec.ts]
- **Test Structure:** [Describe/it pattern, etc.]

## Mocking
- **Strategy:** [How external services are mocked]
- **Fixtures:** `[Path to test fixtures]`

## CI Integration
- **When:** [On PR, on push, scheduled]
- **Required to Pass:** [Which tests gate merges]

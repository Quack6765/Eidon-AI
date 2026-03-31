# Testing

## Strategy
- **Approach:** Unit-heavy testing with a browser smoke test
- **Coverage Target (Default):** **≥ 85%** on new/changed code (prefer patch/new-code coverage; enforce branches/functions when available)

## Test Types
| Type | Location | Runner | Command |
|------|----------|--------|---------|
| Unit | `tests/unit/**/*.test.ts` | Vitest | `npm run test` |
| E2E smoke | `tests/e2e/**/*.spec.ts` | Playwright | `npm run test:e2e` |

## Conventions
- **File Naming:** `*.test.ts` for Vitest, `*.spec.ts` for Playwright
- **Test Structure:** `describe` / `it` with targeted coverage of auth, provider streaming, compaction, and storage
- **E2E Isolation:** `npm run test:e2e` starts Next with a fresh `.e2e-data` and `test-results` directory for each run so sidebar, settings, and attachment flows do not inherit stale fixture state

## Mocking
- **Strategy:** Mock the OpenAI-compatible client in unit tests
- **Fixtures:** Inline objects in each test file

## CI Integration
- **When:** Intended for PR gating and local verification
- **Required to Pass:** `lint`, `typecheck`, `test`, and `test:e2e`

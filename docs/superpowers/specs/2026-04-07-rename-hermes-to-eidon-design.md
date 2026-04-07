# Rename Hermes → Eidon

## Summary

Full rename of all "Hermes" references to "Eidon" across the codebase. This is a complete rebrand — user-visible text, environment variables, internal naming, database filename, session cookie, package name, images, and documentation are all updated. Breaking change for existing deployments.

## Changes

### 1. Central Constants (`lib/constants.ts`)
- `APP_NAME`: `"Hermes"` → `"Eidon"`
- `SESSION_COOKIE_NAME`: `"hermes_session"` → `"eidon_session"`

### 2. Environment Variables

All `HERMES_*` env vars renamed to `EIDON_*`:

| Old | New |
|-----|-----|
| `HERMES_PASSWORD_LOGIN_ENABLED` | `EIDON_PASSWORD_LOGIN_ENABLED` |
| `HERMES_ADMIN_USERNAME` | `EIDON_ADMIN_USERNAME` |
| `HERMES_ADMIN_PASSWORD` | `EIDON_ADMIN_PASSWORD` |
| `HERMES_SESSION_SECRET` | `EIDON_SESSION_SECRET` |
| `HERMES_ENCRYPTION_SECRET` | `EIDON_ENCRYPTION_SECRET` |
| `HERMES_DATA_DIR` | `EIDON_DATA_DIR` |

Files: `lib/env.ts`, `lib/auth.ts`, `lib/db.ts`, `playwright.config.ts`, `Dockerfile`, `middleware.ts`, `.env`

### 3. UI Text (hardcoded JSX strings)
- `components/login-form.tsx` — "Hermes" → "Eidon"
- `components/sidebar.tsx` — "Hermes" → "Eidon"
- `components/shell.tsx` — "Hermes" → "Eidon"

### 4. Database Filename
- `lib/db.ts` — `"hermes.db"` → `"eidon.db"`
- `tests/unit/db.test.ts` — `"hermes.db"` → `"eidon.db"`

### 5. Images
- Copy `/Users/charles/Downloads/eidon-full.png` → `public/logo.png` (overwrite existing)
- Copy `/Users/charles/Downloads/eidon-profile-pic.png` → `public/chat-icon.png` (overwrite existing)
- No code reference changes needed — filenames stay the same

### 6. Package Name
- `package.json` — `"name": "hermes"` → `"name": "eidon"`
- `package-lock.json` — same rename

### 7. Documentation
- `README.md` — all "Hermes" → "Eidon", all `HERMES_*` → `EIDON_*`
- `agent-memory/**/*.md` — all references updated
- `docs/superpowers/**/*.md` — all references updated

### 8. No Changes Needed
- `.gitignore`, `.data/` directory — gitignored, DB uses new name going forward
- No migration needed — no existing production deployments

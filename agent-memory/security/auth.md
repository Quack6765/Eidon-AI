# Authentication

## Provider
- **Service:** Local single-user auth
- **Location:** `lib/auth.ts`

## Session
- **Type:** Signed cookie plus server-side SQLite session row
- **Duration:** 30 days
- **Refresh:** No rolling refresh in v1; login creates a new session

## Flows
- **Login:** Username/password POST to `/api/auth/login` when `HERMES_PASSWORD_LOGIN_ENABLED=true`
- **Logout:** `/api/auth/logout` deletes the session row and clears the cookie
- **Password Reset:** Not implemented; password changes happen from `/settings`
- **Disabled mode:** When `HERMES_PASSWORD_LOGIN_ENABLED=false`, requests bypass the login screen and the app uses the bootstrapped admin user directly

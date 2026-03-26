# Authentication

## Provider
- **Service:** Local single-user auth
- **Location:** `lib/auth.ts`

## Session
- **Type:** Signed cookie plus server-side SQLite session row
- **Duration:** 30 days
- **Refresh:** No rolling refresh in v1; login creates a new session

## Flows
- **Login:** Username/password POST to `/api/auth/login`
- **Logout:** `/api/auth/logout` deletes the session row and clears the cookie
- **Password Reset:** Not implemented; password changes happen from `/settings`

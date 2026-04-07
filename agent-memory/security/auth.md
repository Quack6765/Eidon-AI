# Authentication

## Provider
- **Service:** Local single-user auth
- **Location:** `lib/auth.ts`

## Session
- **Type:** Signed cookie plus server-side SQLite session row
- **Duration:** 30 days
- **Refresh:** No rolling refresh in v1; login creates a new session
- **Cookie security:** Production login cookies are marked `Secure` only when the incoming request is HTTPS (including `x-forwarded-proto` / `Forwarded` proxy headers), so Docker deployments behind HTTP do not silently drop the session cookie

## Flows
- **Login:** Username/password POST to `/api/auth/login` when `EIDON_PASSWORD_LOGIN_ENABLED=true`
- **Logout:** `/api/auth/logout` deletes the session row and clears the cookie
- **Stale sessions:** `getCurrentUser()` is read-only during server rendering; when a signed cookie points at a missing or expired DB session, protected pages redirect to `/login` and the login page is allowed to render so the user can recover without a cookie mutation during SSR
- **Password Reset:** Not implemented; password changes happen from `/settings`
- **Disabled mode:** When `EIDON_PASSWORD_LOGIN_ENABLED=false`, requests bypass the login screen and the app uses the bootstrapped admin user directly

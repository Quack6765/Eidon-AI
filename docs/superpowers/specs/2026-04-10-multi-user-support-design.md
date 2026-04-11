---
name: Multi-User Support
description: Add isolated user workspaces with env-backed super-admin auth and role-based settings access
type: design
---

# Multi-User Support Design

## Summary

Convert Eidon from a single-user workspace into a multi-user server with isolated per-user data and role-based access control.

The system should support:

- an env-backed super-admin account that cannot be locked out through the UI
- managed local users with username/password login and `admin` or `user` roles
- private per-user conversations, personas, memories, scheduled automations, folders, and account settings
- server-wide provider profiles, MCP servers, and skills that are managed only by admins

When password login is disabled, the app should keep the current single-user bypass behavior and hide all multi-user management features.

## Goals

- Multiple users can use the same server without sharing conversations, personas, memories, or automations
- The env super-admin can use the app like a normal admin account, with all private data stored in the database
- Super-admin credentials remain env-backed rather than editable in the database
- Admin-only server configuration is clearly separated from user-private preferences
- Authorization is enforced server-side for both routes and APIs

## Non-Goals

- Shared conversations, shared workspaces, or team/org concepts
- Admin visibility into other users' private data
- A migration plan for existing installations
- Multi-user support when `EIDON_PASSWORD_LOGIN_ENABLED=false`

## Product Model

### User types

The app supports two persisted user identities:

- `env_super_admin`
- `local`

Both are represented in the same `users` table and can own private data. The difference is how they authenticate:

- `env_super_admin` authenticates only with `EIDON_ADMIN_USERNAME` and `EIDON_ADMIN_PASSWORD`
- `local` users authenticate with a database-stored password hash

### Roles

Each user has a role:

- `admin`
- `user`

Admins can manage server-wide settings and managed users. Regular users cannot.

### Scope split

#### Server-wide, admin-managed

- Providers
- MCP Servers
- Skills
- Users

#### User-private

- General
- Personas
- Scheduled automations
- Memories
- Account
- Conversations and folders

This is a mixed-scope product model: some resources are global to the server, while others are strictly user-owned.

## Authentication Design

### Unified persisted identity

Replace the current `admin_users` model with a unified `users` table.

Recommended schema:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  auth_source TEXT NOT NULL,
  password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Rules:

- `role` is `admin` or `user`
- `auth_source` is `env_super_admin` or `local`
- `password_hash` is required for `local`
- `password_hash` is `NULL` for `env_super_admin`

### Env super-admin bootstrap

When password login is enabled, startup should ensure one env-super-admin row exists in `users`:

- `username = EIDON_ADMIN_USERNAME`
- `role = admin`
- `auth_source = env_super_admin`
- `password_hash = NULL`

The row must be usable as a normal account owner for conversations, personas, memories, automations, and private settings.

### Username sync behavior

If `EIDON_ADMIN_USERNAME` changes:

- update the existing `env_super_admin` row in place
- do not create a duplicate user

If a `local` user already exists with the new env username, startup should fail loudly rather than guess how to reconcile identities.

### Login flow

When password login is enabled:

1. Look up the submitted username
2. If it matches an `env_super_admin` row, validate the password against env
3. If it matches a `local` row, validate against `password_hash`
4. Create a session bound to the persisted `users.id`

This keeps all sessions anchored to real database users, including the env super-admin.

### Password-login-disabled mode

When `EIDON_PASSWORD_LOGIN_ENABLED=false`:

- keep the existing bypass behavior
- auto-enter the app as the env super-admin account
- hide the `Users` settings page
- return `404` from multi-user management routes and APIs

The database can still contain the persisted env-super-admin row, but the product behaves as a single-user app in this mode.

## Authorization Model

### Route and API guards

After authentication, the app should derive:

- `userId`
- `role`
- `authSource`

Then enforce one of two authorization patterns:

- `requireAdminUser()` for server-wide resources
- owner-scoped queries for user-private resources

### Ownership rule

Admins do not get special read access into other users' private data.

That means:

- an admin can manage users and global server settings
- an admin cannot browse another user's conversations, personas, memories, folders, or automations

This keeps the first version simple and predictable.

## Data Model

### Split settings by scope

The current `app_settings` table mixes personal preferences with global configuration. Multi-user support should split this into two concepts:

#### User-private settings

Create a `user_settings` table keyed by `user_id` for:

- `default_provider_profile_id`
- `skills_enabled`
- `conversation_retention`
- `auto_compaction`
- `memories_enabled`
- `memories_max_count`
- `mcp_timeout`
- timestamps

Recommended schema:

```sql
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  default_provider_profile_id TEXT,
  skills_enabled INTEGER NOT NULL DEFAULT 1,
  conversation_retention TEXT NOT NULL DEFAULT 'forever',
  auto_compaction INTEGER NOT NULL DEFAULT 1,
  memories_enabled INTEGER NOT NULL DEFAULT 1,
  memories_max_count INTEGER NOT NULL DEFAULT 100,
  mcp_timeout INTEGER NOT NULL DEFAULT 120000,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (default_provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL
);
```

This preserves the current product behavior while making `General` user-private.

#### Server-wide settings

Provider profiles, MCP servers, and skills remain in global tables and are not duplicated per user.

### Private tables

Add `user_id` ownership to all top-level private resources:

- `folders`
- `conversations`
- `personas`
- `user_memories`
- `automations`

Recommended new columns:

```sql
ALTER TABLE folders ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE personas ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE user_memories ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE automations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
```

### Indirectly-owned tables

These remain ownership-inherited through their parent records:

- `messages` via `conversations`
- `memory_nodes` via `conversations`
- `compaction_events` via `conversations`
- `message_attachments` via `conversations`
- `automation_runs` via `automations` and `conversations`

Do not add direct `user_id` columns to these inherited tables in v1. All access must remain parent-scoped.

### Global tables

These remain server-wide:

- `users`
- `provider_profiles`
- `mcp_servers`
- `skills`

## Settings Navigation And Permissions

### Visible nav items for admins

- `General`
- `Providers`
- `Personas`
- `Scheduled automations`
- `Memories`
- `MCP Servers`
- `Skills`
- `Users`
- `Account`

### Visible nav items for regular users

- `General`
- `Personas`
- `Scheduled automations`
- `Memories`
- `Account`

### Users page visibility

Show the `Users` page only when:

- password login is enabled, and
- the current user role is `admin`

Hide it otherwise.

### Server-side enforcement

Navigation filtering is not sufficient. All admin-only pages and APIs must also reject non-admin access server-side.

## Users Page

### Route

- `/settings/users`

### Supported actions

- create user with username, password, and role
- edit username
- edit role
- reset/change password
- delete user

### Protected behavior

The env super-admin should appear in the user list but with restricted controls:

- cannot be deleted
- cannot have its role changed
- cannot have credentials edited in the UI
- the UI must explicitly indicate that its login credentials are managed by env

Self-delete should be blocked for managed admins to avoid accidental lockout paths.

### Create-user requirements

- username must be unique
- password must be required for local users
- role must be `admin` or `user`
- all newly created users start with a clean state

No default cloning of conversations, personas, memories, or settings.

## Account Page

### Shared behavior

All users retain access to `/settings/account`.

### Local users

Local users can change their own password from the account page.

### Env super-admin

The env super-admin can use the account page for account information, but credential editing must be disabled with clear copy stating that login credentials are managed by environment variables.

## Provider, MCP, And Skill Semantics

### Providers

Provider profiles are global to the server, but each user keeps a private `default_provider_profile_id` in `user_settings`.

This means:

- admins manage the shared provider profile catalog
- each user chooses their own default provider profile

### Skills

Skill definitions are global and admin-managed, but the existing `skills_enabled` toggle remains user-private in `General`.

This means:

- admins manage which skills exist and whether a skill is enabled server-wide
- each user controls whether workspace skills are active in their own session behavior

### MCP Servers

MCP server definitions remain global and admin-managed. User-specific runtime timeout remains in `user_settings` because `General` is user-private.

## Conversations And Private Data

### Private ownership

Each user owns only their own:

- folders
- conversations
- personas
- memories
- automations
- automation run history

All list and get operations for these resources must be filtered by the authenticated `user_id`.

### Sidebar and settings implications

- the main chat sidebar shows only the current user's conversations and folders
- settings pages for personas, memories, and automations operate only on the current user's records
- the env super-admin sees only their own private data, not everyone's data

## Deletion Behavior

Deleting a local user should cascade through all of that user's private data:

- folders
- conversations
- messages
- memory nodes
- compaction events
- message attachments
- personas
- user memories
- automations
- automation runs
- user settings
- auth sessions

The env super-admin cannot be deleted.

## API Shape

### Auth

Keep the current login/session model, but back it with `users` rather than `admin_users`.

### New user-management APIs

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/[userId]`
- `DELETE /api/users/[userId]`

These should be admin-only and unavailable when password login is disabled.
These should be admin-only and return `404` when password login is disabled.

### Existing private-resource APIs

Existing APIs for:

- conversations
- personas
- memories
- automations
- folders
- account

must all become owner-scoped based on the authenticated `user_id`.

### Existing global-resource APIs

Existing APIs for:

- settings pages that manage provider profiles
- MCP servers
- skills

must become admin-only.

## UI Notes

### Login screen

The login screen remains username/password based when password login is enabled. No special UI flow is required for the env super-admin beyond correct backend authentication handling.

### Settings copy

The account and users UI should make the env-super-admin distinction explicit:

- on the users page, mark the env-super-admin row as env-managed
- on the account page, show that password changes are unavailable for env-managed login

### Hidden multi-user mode

When password login is disabled:

- hide the users nav item
- hide entry points for user management
- keep the app feeling like a single-user deployment

## Testing

Add coverage for:

- env-super-admin bootstrap row creation
- env-super-admin username sync on startup
- startup failure when env username collides with an existing local user
- env-super-admin login using env password
- local-user login using database password hash
- user settings isolation
- conversation, persona, memory, folder, and automation owner scoping
- admin-only access to providers, MCP servers, skills, and users
- regular-user denial for admin-only routes and APIs
- local-user self password change
- env-super-admin account page credential restrictions
- local-user deletion cascade
- password-login-disabled mode hiding and disabling multi-user management

## Files Likely To Change

| File | Purpose |
|------|---------|
| `lib/db.ts` | Replace single-user auth schema, add `users`, `user_settings`, and `user_id` ownership columns |
| `lib/auth.ts` | Unified login flow for env super-admin and local users |
| `lib/types.ts` | Add `User`, `UserRole`, `AuthSource`, and split user-private settings types |
| `lib/settings.ts` | Move personal settings to `user_settings` and keep global provider access admin-only |
| `lib/conversations.ts` | Scope all conversation queries by authenticated user |
| `lib/folders.ts` | Scope folder queries by authenticated user |
| `lib/personas.ts` | Scope persona CRUD by authenticated user |
| `lib/memories.ts` | Scope memory CRUD by authenticated user |
| `lib/automations.ts` | Scope automation CRUD and listing by authenticated user |
| `components/settings/settings-nav.tsx` | Role-aware settings navigation and new `Users` item |
| `app/settings/users/page.tsx` | New user-management settings page |
| `app/settings/account/page.tsx` | Self-password-change flow and env-managed credential messaging |
| `app/api/users/*` | Admin-only user management APIs |
| `app/api/*` private resource routes | Owner scoping by authenticated user |
| `middleware.ts` and settings layouts | Route-level access control and hidden multi-user mode behavior |

## Implementation Notes

- Fail startup rather than silently repairing identity collisions involving the env super-admin username
- Keep the first version strictly private-by-owner for all user data
- Do not introduce workspace/org abstractions until there is a real need for shared data

# Memory Index

**Purpose:** This is your project memory. Use it to understand the system before making changes.

**How to use:**
1. Read `constitution.md` first — it defines the rules you must follow
2. Based on your task, load only the relevant file(s) listed below
3. Update files when you change system behavior

---

## Constitution
`constitution.md` — **Always read first. Contains rules you must follow on every task.**

---

## Context Modules

### architecture/
| File | Load when... |
|------|--------------|
| `stack.md` | You need to know what languages, frameworks, or libraries the project uses |
| `database.md` | You're working with the database, writing queries, or need to understand data access patterns |
| `platform.md` | You need to know where the app runs (cloud provider, servers, serverless, etc.) |

### backend/
| File | Load when... |
|------|--------------|
| `api.md` | You're creating or modifying API endpoints, or need to understand request/response patterns |
| `services.md` | You're working with business logic, or need to understand how services are organized |
| `jobs.md` | You're working with scheduled tasks, cron jobs, or background processing |

### frontend/
| File | Load when... |
|------|--------------|
| `ui.md` | You're working on UI, styling, components, or need design system details (colors, fonts, spacing) |
| `routing.md` | You're adding pages, modifying navigation, or working with protected routes |
| `state.md` | You're working with state management, data fetching, or caching on the client |

### data/
| File | Load when... |
|------|--------------|
| `models.md` | You need to understand the data entities, their fields, or relationships between them |
| `validation.md` | You're implementing input validation or need to know validation rules |

### infrastructure/
| File | Load when... |
|------|--------------|
| `local.md` | You need to run the project locally, or troubleshoot development setup |
| `deployment.md` | You're working with CI/CD, deployments, or release processes |
| `config.md` | You need to know what environment variables exist or how configuration works |
| `testing.md` | You're writing tests, need to know the testing strategy, or understand test conventions |

### security/
| File | Load when... |
|------|--------------|
| `auth.md` | You're working with login, logout, sessions, or authentication flows |
| `access.md` | You need to understand user roles, permissions, or authorization rules |
| `secrets.md` | You're working with API keys, credentials, or sensitive data handling |

### product/
| File | Load when... |
|------|--------------|
| `about.md` | You need to understand what the product does, who uses it, or its core features |
| `domain.md` | You encounter domain-specific terms or need to understand business concepts |
| `constraints.md` | You need to know business rules, limits, or policies (e.g., "users must verify email before X") |

### integrations/
| File | Load when... |
|------|--------------|
| `payments.md` | You're working with payment processing, billing, or subscriptions |
| `notifications.md` | You're working with email, SMS, or push notifications |
| `external.md` | You're integrating with any other third-party API or external service |

### custom-integrations/
Raw external documentation (API specs, schemas, etc.) added by the user.

| File | Load when... |
|------|--------------|
| `*` | You're working with an external service and need exact API specs, schemas, or documentation. Match filenames to the service you're integrating with. |

> **Note:** Scout should scan this folder and include relevant files in the Scout Report when working on integrations. Only load files that match the service being worked on — do not bulk-load.

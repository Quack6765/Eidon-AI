# Configuration

## Environment Variables
| Variable | Purpose | Required |
|----------|---------|----------|
| `HERMES_ADMIN_USERNAME` | Initial admin username | Yes |
| `HERMES_ADMIN_PASSWORD` | Initial admin password | Yes |
| `HERMES_SESSION_SECRET` | Session signing secret | Yes |
| `HERMES_ENCRYPTION_SECRET` | Encryption key seed for stored provider credentials | Yes |
| `HERMES_DATA_DIR` | Directory containing the SQLite database | No |

## By Environment
| Variable | Dev | Staging | Prod |
|----------|-----|---------|------|
| `HERMES_DATA_DIR` | `./.data` | mounted volume | mounted volume |
| bootstrap secrets | local `.env` values | deployment secret store | deployment secret store |

## Management
- **Local:** `.env.local` (gitignored)
- **Deployed:** Container environment
- **Secrets:** Runtime env vars; provider API key is re-encrypted before database storage

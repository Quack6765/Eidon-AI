# Configuration

## Environment Variables
| Variable | Purpose | Required |
|----------|---------|----------|
| `EIDON_PASSWORD_LOGIN_ENABLED` | Enable the local username/password login flow | No |
| `EIDON_ADMIN_USERNAME` | Initial admin username | Yes |
| `EIDON_ADMIN_PASSWORD` | Initial admin password | Yes |
| `EIDON_SESSION_SECRET` | Session signing secret | Yes |
| `EIDON_ENCRYPTION_SECRET` | Encryption key seed for stored provider credentials | Yes |
| `EIDON_DATA_DIR` | Directory containing the SQLite database | No |

## By Environment
| Variable | Dev | Staging | Prod |
|----------|-----|---------|------|
| `EIDON_PASSWORD_LOGIN_ENABLED` | `false` | deployment env | `true` in Docker image |
| `EIDON_DATA_DIR` | `./.data` | mounted volume | mounted volume |
| bootstrap secrets | local `.env` values or non-production defaults | deployment secret store | deployment secret store; startup fails if admin password/session secret/encryption secret are missing or left at published placeholder/default values |

## Runtime Defaults
- Default OpenAI model: `gpt-5-mini`
- Default API mode: `responses`

## Management
- **Local:** `.env.local` (gitignored)
- **Deployed:** Container environment
- **Secrets:** Runtime env vars; provider API key is re-encrypted before database storage
- **Docker build:** Production image builds can run without runtime auth secrets; validation happens when auth/session/encryption code accesses those values at runtime

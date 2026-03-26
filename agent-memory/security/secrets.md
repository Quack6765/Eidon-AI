# Secrets

## Storage
- **Location:** Environment variables for bootstrap secrets; encrypted SQLite field for provider API key
- **Access:** Server-only code in route handlers and `lib/`

## Handling
- **Never:** Commit to version control
- **Never:** Log in plain text
- **Never:** Expose to client

## Rotation
- **Policy:** Manual rotation
- **Process:** Change env vars during redeploy and update provider API key from the settings UI

## PII
- **Encryption:** Provider API key encrypted at rest; credentials and sessions expected over HTTPS in transit
- **Logging:** Do not log passwords, cookies, or decrypted provider keys

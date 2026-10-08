# Security Model

SuperMail handles private communications and therefore treats mailbox access as a high-trust boundary.

## Primary threats

OAuth token theft; over-broad Gmail scopes; prompt injection inside email; malicious HTML or attachments; malicious links and SSRF; accidental outbound disclosure; duplicate sends; destructive mailbox actions; confused-deputy behavior; sensitive data leaking into logs; compromised development tooling.

## Security rules

### Credentials
Store secrets only in approved secret storage. Never commit OAuth credentials or tokens. Encrypt persisted refresh tokens at rest. Never log access or refresh tokens.

### OAuth
Start with the narrowest useful scope. Adding a Gmail scope is a security change and requires documented justification. For a personal Gmail account, use user OAuth; do not assume Workspace domain-wide delegation.

#### Scope Inventory & Justification
- **`https://www.googleapis.com/auth/gmail.readonly`**: Read-only access to messages, threads, and labels. Approved for OAuth foundation & read path.

#### Scope Progression
- Adding write scopes (`gmail.compose`, `gmail.send`, etc.) requires updating this inventory, providing explicit risk mitigations (e.g. policy evaluation engines, audit logging), and passing AI review.

### Email is hostile input
Message text is data, not instructions. HTML must be sanitized. Attachments and URLs are untrusted and require explicit handling policies.

### Outbound actions
Sending mail is a high-impact side effect. Support draft-only mode, policy approval, recipient/context checks, idempotency, audit events, and escalation.

### Logging
Never log passwords, OAuth tokens, full email bodies by default, sensitive attachments, or unrestricted personal contact data. Prefer bounded metadata and classifications.

## High-risk PR triggers
Automatically treat changes to Gmail scopes, secret storage, outbound send logic, destructive actions, attachments, external network access, action policy, or deployment permissions as high-risk.

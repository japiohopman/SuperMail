# Gmail Integration Plan

## Phase 1 — OAuth foundation

Use Gmail API OAuth for the personal mailbox. Document client credentials, redirect URIs, scopes, token storage, local setup, and production secret storage. No Gmail credential belongs in Git.

### Scopes & Least Privilege
The initial OAuth foundation enforces least privilege by requesting only read-oriented scopes:

- **`https://www.googleapis.com/auth/gmail.readonly`**: Read-only access to Gmail resources (messages, threads, labels, and headers).
  - **Justification**: This initial milestone requires reading mailbox metadata, threads, messages, and labels for processing and indexing without granting any modification, send, or delete permissions.

### Path to Adding Write Scopes Later
When write operations (e.g. creating drafts, sending messages) are required in future phases:
1. **Draft Creation**: Request `https://www.googleapis.com/auth/gmail.compose` for draft creation without direct send permissions.
2. **Sending**: Request `https://www.googleapis.com/auth/gmail.send` only after policy evaluation, idempotency controls, and approval mechanisms are in place.
3. **Security Review Trigger**: Any expansion beyond `gmail.readonly` constitutes a high-risk security change. It must update `docs/SECURITY.md`, undergo explicit AI and architectural review, and be justified against specific feature requirements.

## Phase 2 — Read path

Implement authorization, thread/message/label retrieval, incremental synchronization, and normalization into the SuperMail domain.

## Phase 3 — Event path

Use Gmail push/watch mechanisms where appropriate, backed by history synchronization and reconciliation. A notification is only a signal to synchronize.

## Phase 4 — Write path

Build drafts before autonomous sending. Add narrowly scoped outbound operations only after policy, idempotency, audit, and failure handling exist.

## Initial non-goals

No bulk deletion, automatic forwarding, unrestricted attachment uploads, arbitrary URL fetching from messages, or broad Gmail scope access for convenience.

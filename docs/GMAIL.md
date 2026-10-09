# Gmail Integration Plan

## Phase 1 — OAuth foundation

Use Gmail API OAuth for the personal mailbox. Document client credentials, redirect URIs, scopes, token storage, local setup, and production secret storage. No Gmail credential belongs in Git.

## Phase 2 — Read path

Implement authorization, thread/message/label retrieval, incremental synchronization, and normalization into the SuperMail domain.

## Phase 3 — Event path

Use Gmail push/watch mechanisms where appropriate, backed by history synchronization and reconciliation. A notification is only a signal to synchronize.

See [GMAIL_SYNC.md](GMAIL_SYNC.md) for detailed documentation on deterministic synchronization, history cursor management, and automated reconciliation recovery.

## Phase 4 — Write path

Build drafts before autonomous sending. Add narrowly scoped outbound operations only after policy, idempotency, audit, and failure handling exist.

## Initial non-goals

No bulk deletion, automatic forwarding, unrestricted attachment uploads, arbitrary URL fetching from messages, or broad Gmail scope access for convenience.

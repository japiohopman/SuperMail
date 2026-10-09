# Gmail History Synchronization and Reconciliation Architecture

## Overview

The SuperMail synchronization architecture ensures deterministic mailbox state synchronization and automatic recovery from missing or stale Gmail event notifications.

## Key Principles

1. **State Independence**: Transport/API data is decoupled from the domain state (`MailboxStore`). Provider payloads are sanitized through `Message.fromGmailPayload()` to prevent raw API structures or internal headers from leaking into domain models.
2. **Deterministic Cursor Tracking**: The domain state tracks `lastHistoryId`. Each successful synchronization or message update advances this cursor monotonically.
3. **Idempotency & Safe Replay**: Processing the same history events or full reconciliation multiple times yields identical store states without duplication or corruption.
4. **Push-as-Signal / Pull-to-Sync**: Event notifications (e.g., Pub/Sub or webhooks) serve solely as signals that activity occurred. Synchronizations always fetch the delta or full state directly from the provider.

## Synchronization Modes

### 1. Incremental Sync (`engine.sync()`)

When an existing `lastHistoryId` is present in `MailboxStore`:
- Queries `provider.listHistory({ startHistoryId })`.
- Processes history records in strict sequence:
  - `messagesAdded`: fetches updated message payloads and upserts into `MailboxStore`.
  - `messagesDeleted`: removes message IDs from `MailboxStore`.
  - `labelsAdded`: updates label sets for messages in `MailboxStore`.
  - `labelsRemoved`: removes specified labels for messages in `MailboxStore`.
- Updates `lastHistoryId` to the latest provider history ID.

### 2. Full Reconciliation Sync (`engine.reconcile()`)

Executed when:
- Cold start / no existing `lastHistoryId`.
- History gap or expired history cursor (`StaleHistoryError` or provider history list invalidation).
- Explicit operator / maintenance health request.

Behavior:
- Fetches profile information for current `historyId`.
- Lists all active mailbox messages and hydrates complete message state into domain objects.
- Overwrites `MailboxStore` state cleanly (`reconcile`).
- Returns synchronization result metadata containing `{ type: "full", recovered: true, reason: ... }`.

## Failure and Recovery Scenarios

| Failure Scenario | Detection Mechanism | Recovery Behavior |
| --- | --- | --- |
| Cold Start / No History ID | `store.getHistoryId() === null` | Automatically runs Full Reconciliation Sync. |
| Missed Push Notification | Delayed or skipped push event | Next sync poll or push notification fetches all history changes since `lastHistoryId`. |
| Stale or Purged History Cursor | Gmail returns `404` / `400` / `StaleHistoryError` for `startHistoryId` | `SyncEngine` catches error and triggers Full Reconciliation Sync automatically (`recovered: true`, `reason: "stale_history"`). |
| Partial Network Failure | Exception thrown during provider fetch | Sync aborts without advancing `lastHistoryId`; retrying re-evaluates from last valid `lastHistoryId`. |

## Safety Controls

- No real mailbox credentials or live network connections are required for tests (mock provider and fixtures are used).
- Outbound mailbox actions remain strictly prohibited within the sync pipeline.

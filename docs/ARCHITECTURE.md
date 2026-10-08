# SuperMail Architecture

## Two separate planes

Development plane:

Roadmap -> Dispatcher -> Jules -> GitHub PR -> AI Review -> Merge

Runtime plane:

Gmail -> Sync/Event Ingestion -> Mail Domain -> Policy -> Agent Reasoning -> Action Executor -> Audit/Escalation

The runtime plane never inherits development authority.

## Runtime components

### Gmail adapter
Owns OAuth, history synchronization, watches/events, threads/messages/labels, and drafts/outbound primitives.

### Mail domain
Normalizes provider data into Account, Thread, Message, Participant, Attachment, Label, Draft, Action, and AuditEvent.

### Policy engine
Evaluates action type, recipient/context, content sensitivity, confidence, reversibility, financial/legal/security impact, and approval requirements.

### Agent reasoning
Produces structured intent rather than directly invoking Gmail side effects. The policy engine decides whether the intent can become an executable action.

### Action executor
The only component allowed to invoke Gmail write operations. It requires a policy-approved action and emits an audit event.

### Audit layer
Records what happened, why, which policy decision allowed it, what external action occurred, and whether approval was involved. Do not store unrestricted private-mail content in logs.

## Event-driven direction
Use Gmail notifications as a signal to synchronize. The mailbox state remains the source of truth. A reconciliation/full-sync path is mandatory so missed notifications do not create permanent blind spots.

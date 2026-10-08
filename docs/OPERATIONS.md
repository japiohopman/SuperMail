# Operations

SuperMail is not production-ready at foundation stage.

Use separate credentials/configuration for local, CI, and production environments. Never use a real mailbox in CI.

Production rollout should start in read-only mode, then draft-only mode, then narrowly scoped autonomous send. Expanded autonomy requires evidence.

Production must have a way to disable autonomous actions, revoke OAuth credentials, stop workers, inspect recent audit events, recover from duplicate delivery/retry, and reconcile mailbox state. A kill switch must disable outbound actions without deleting state.

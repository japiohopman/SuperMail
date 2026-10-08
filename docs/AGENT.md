# Agent Operating Model

## Roles

### ChatGPT — architect and reviewer
Responsible for architecture, security decisions, dependency-ordered issues, precise Jules instructions, PR review, merge safety, and escalation decisions.

### Google Jules — implementation agent
Implements one issue at a time, writes tests, updates docs, reports verification, opens a PR, and responds to review findings. Jules must not expand scope silently.

### Dispatcher — development orchestrator
Finds the next unblocked roadmap-ready issue, creates a durable claim/session identity, prevents duplicate work, hands the exact issue contract to Jules, and records state transitions. It does not decide architecture or merge code.

### SuperMail runtime agent — mailbox secretary
Reads/synchronizes Gmail, reasons over messages, proposes or performs allowed actions, records decisions, and escalates when policy requires it. Runtime permissions are independent from GitHub development permissions.

## Review contract
Every review receives the issue and acceptance criteria, PR description, complete diff, CI state, relevant architecture/security docs, and previous review state for the PR head SHA.

Review identity is repository + pull request + head SHA. A new head SHA requires a fresh review.

## Review outcomes
- approved: safe to merge
- changes_requested: concrete fixes required; Jules continues
- escalate: security, policy, legal, destructive, or architectural uncertainty exceeds autonomous authority

The target is a closed engineering loop where humans handle exceptions rather than routine code inspection.

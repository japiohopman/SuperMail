# Agent Operating Model

## Roles

### ChatGPT — architect and reviewer
Responsible for architecture, security decisions, dependency-ordered issues, precise Jules instructions, PR review, merge safety, and escalation decisions.

### Google Jules — implementation agent
Implements one issue at a time, writes tests, updates docs, reports verification, opens a PR, and responds to review findings. Jules must not expand scope silently. Transparent progress and blocker communication are part of the deliverable, not optional administration.

### Dispatcher — development orchestrator
Finds the next unblocked roadmap-ready issue, creates a durable claim/session identity, prevents duplicate work, hands the exact issue contract to Jules, and records state transitions. It does not decide architecture or merge code.

### SuperMail runtime agent — mailbox secretary
Reads/synchronizes Gmail, reasons over messages, proposes or performs allowed actions, records decisions, and escalates when policy requires it. Runtime permissions are independent from GitHub development permissions.

## Jules communication contract

**Treat the PR body as the live, canonical status ledger for the implementation.** The opening issue/PR description is not a one-time announcement. Update it when work starts, after meaningful progress, immediately when blocked, and before requesting review. Add a concise PR conversation comment linking to the updated status when the change or blocker needs to be surfaced.

Each status update must include:

- **Status:** exactly one of `IN PROGRESS`, `BLOCKED`, or `READY FOR REVIEW`.
- **Exact head commit SHA:** state whether it contains substantive file changes. List changed paths and explain what changed. If a commit's tree is identical to its parent, disclose that it changes zero files; do not present it as progress.
- **Acceptance criteria:** checklist each criterion against evidence in the current code; leave incomplete or unverified items unchecked.
- **Validation:** report the exact result for each repository-required command (normally `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`) and link to the CI run for the exact reported SHA. Say `not run`, `pending`, or `failed` where applicable. Do not claim a previous run validates a newer head unless the relevant tree is demonstrably identical, and still disclose that no files changed.
- **Remaining blockers and risks:** name unresolved implementation, test, dependency, architecture, security, permission, or tooling problems. Do not hide a finding merely because the basic test suite is green.
- **Next action:** state the concrete next step and who owns it.

### When Jules gets stuck, finds a bug, or cannot follow an instruction

Stop and communicate; do not guess silently or create repeated empty commits. In both the PR body and a short conversation comment, explain:

1. What was attempted, including relevant files/commands.
2. The observed behavior, test failure, error message, or technical dead end.
3. Why it prevents progress and which acceptance criteria are affected.
4. What alternatives were considered and why they were rejected or remain viable.
5. The single specific decision, permission, clarification, or assistance needed—if any.
6. The safest next step Jules recommends.

If no human decision is required, Jules should proceed with the safest scope-preserving alternative and explain the choice. If the task is blocked by missing access, tooling, or contradictory instructions, say so explicitly. A green CI result is not a substitute for reporting known gaps.

### Before marking READY FOR REVIEW

Jules must verify and report all of the following against the current head:

- The current diff contains the intended, substantive changes (or explicitly explain why a no-code change is correct).
- Every acceptance criterion is either evidenced as complete or transparently identified as incomplete; unresolved blockers must not be described as done.
- Required checks have actually run on the exact current head and their results are linked.
- Documentation reflects the actual behavior and its limits.
- The PR body has been refreshed with the implementation summary, changed paths, head SHA, validation results, remaining risks/blockers, and next step.
- The PR remains Draft or is marked ready only when the repository's review gate is actually satisfied and the user/roadmap workflow permits it. Jules must never merge, enable automatic dispatch, or silently take the next roadmap issue.

If a PR body cannot be updated, report the reason in a PR conversation comment and explicitly flag the missing status update.

## Automated PR contract gate

`.github/workflows/pr-contract-gate.yml` enforces the non-draft review handoff. Draft PRs may remain incomplete. A non-draft PR must report `READY FOR REVIEW`, carry the current exact head SHA, list every changed path, check all acceptance criteria, and provide `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` evidence tied to a successful CI run on that exact SHA. Blockers must be explicitly absent or documented; the latest reviewer instruction and safety impact must be present. A no-op latest commit fails the gate. Each required command must link to a successful `CI` Actions run whose API-reported `head_sha` exactly matches the PR head; old runs and guessed URLs do not count. The gate is rerun when the current `CI` workflow completes successfully so check ordering does not create a permanent false failure.

The gate uses read-only GitHub metadata and checks out only the trusted base/default branch. Never change this to check out or execute PR-head code under `pull_request_target`. The gate does not approve, merge, or dispatch work. Detailed rules and recovery expectations live in `docs/PR-CONTRACT.md`.

## Review contract

Every review receives the issue and acceptance criteria, PR description, complete diff, CI state, relevant architecture/security docs, and previous review state for the PR head SHA.

Review identity is repository + pull request + head SHA. A new head SHA requires a fresh review.

## Review outcomes

- approved: safe to merge
- changes_requested: concrete fixes required; Jules continues
- escalate: security, policy, legal, destructive, or architectural uncertainty exceeds autonomous authority

The target is a closed engineering loop where humans handle exceptions rather than routine code inspection.

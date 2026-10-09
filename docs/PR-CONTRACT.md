# Pull Request Execution Contract

SuperMail treats a non-draft PR as a review handoff, not a progress announcement. The PR Contract Gate checks the handoff before review and re-checks it when the repository CI run completes.

## Status lifecycle

- **IN PROGRESS** — implementation is still underway. Keep the PR in Draft.
- **BLOCKED** — record the attempted command/action, observed evidence, affected acceptance criteria, alternatives, the exact decision/help needed, and the safest next step. Keep the PR in Draft.
- **READY FOR REVIEW** — non-draft only after the implementation is substantive, every acceptance criterion is verified, the PR body reflects the current head, all four required CI commands pass on that exact SHA, and known blockers are disclosed.

The gate skips Draft PRs so incomplete work can be shared safely. A non-draft PR must use `READY FOR REVIEW`; a stale body or failed contract check blocks the handoff.

## What the gate verifies

1. All required PR sections are present, including Safety and the latest reviewer instruction.
2. The status is `READY FOR REVIEW`, and the reported 40-character head SHA matches the live PR head.
3. Every file reported by the GitHub Pull Requests API appears in the PR body's changed-file list.
4. Acceptance criteria use explicit checkboxes and none remain unchecked.
5. `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are reported as passed, each tied to the live head SHA and a successful `CI` Actions run verified through GitHub's API. The run ID is fetched from the current repository and must report both `conclusion: success` and the exact live `head_sha`.
6. Blockers are explicitly declared absent or documented with the required evidence/decision fields.
7. The latest reviewer instruction states required changes, verification required, do-not-change boundaries, and the completion signal.
8. The head commit's tree is not identical to its parent. If GitHub API metadata cannot establish this safely, the gate fails closed.

A successful Actions run for an older SHA never counts as current-head evidence. When the PR is updated before CI finishes, the initial gate may fail; a successful completion of the `CI` workflow triggers a fresh evaluation.

## Security boundary

The workflow uses `pull_request_target` for metadata inspection. It checks out only the trusted base commit (or the default branch when handling a completed CI run), reads PR metadata and GitHub API responses, and never checks out or executes the PR-head code. Permissions are read-only: repository contents, pull requests, and Actions metadata. The contract evaluator is a small dependency-free Node module, and its validation rules have unit tests.

CI continues to run under the separate `pull_request` workflow. This contract gate does not approve reviews, merge PRs, start Jules sessions, or claim that a reviewer agrees with the changes.

## Updating the handoff

When head code changes, update the current head SHA, changed-file list, acceptance criteria, and each verification line after CI completes. Every command line must include the new full SHA and link to a successful `CI` run for that SHA. Preserve incomplete criteria as unchecked while the PR remains Draft. Never use a green CI run to conceal an unresolved functional, security, architecture, or tooling blocker.

The gate validates both the text and selected facts from GitHub's API; it does not prove that prose is honest or replace code review. Review the actual diff and issue contract before approval.

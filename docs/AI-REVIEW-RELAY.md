# AI Review Relay

## Purpose

The repository prepares every non-draft PR for automated AI review. The current GitHub Actions workflow is only a review signal: it adds the `ai-review` label and comments with the exact head SHA. It does not dispatch Jules, validate a provider review, or complete the provider-neutral relay.

## Active Reviewer & Relay Boundary

**CodeRabbit is the active automated reviewer for SuperMail pull requests.**

CodeRabbit is the configured reviewer adapter. The repository configuration lives in `.coderabbit.yaml`; the handoff workflow does not itself trigger or validate a CodeRabbit review.

The review boundary operates as follows:
1. Every review is keyed by `repository + pull_request + head_sha`.
2. A new head SHA invalidates any previous review state and requires a new review.
3. Review feedback must be evaluated against issue acceptance criteria, architectural rules, security policies, and tests before merge.

## Provider Neutrality

The review relay contract remains provider-neutral. While CodeRabbit acts as the active PR reviewer, the dispatcher and state engine do not depend on CodeRabbit-specific internal structures or UI markup.

Future reviewers (such as self-hosted models or event-triggered review tasks) interface through the same review status and SHA-tracking contract.

## Review Input Requirements

Reviews evaluate:
- Repository instructions (`AGENTS.md`, `docs/DISPATCH.md`)
- Linked issue details and acceptance criteria
- PR body and explicit `@Jules` instructions
- Full pull request diff
- Current CI build and test execution status
- Security impact and architecture boundaries
- Previous review state and historical feedback for the current PR head SHA

Reviewers must never execute untrusted pull-request code. A future relay must validate reviewer identity, repository, PR number, current head SHA, CI state, and linked issue before accepting review output.

## Merge Policy

- Green CI alone does not constitute architectural approval.
- High-risk changes (Gmail OAuth scopes, token handling, outbound actions, destructive operations) require escalation.
- No PR may be merged with unresolved review blockers.

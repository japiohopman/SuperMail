# AI Review Relay

## Purpose

The repository prepares every non-draft PR for automated AI review. The GitHub workflow signals review readiness by adding the `ai-review` label and posting a PR comment that includes the current head SHA. Starting the review lifecycle is the responsibility of the reviewer integration that implements it.

## Active Reviewer & Relay Boundary

**CodeRabbit is the active automated reviewer for SuperMail pull requests.**

CodeRabbit automatic reviews are configured in `.coderabbit.yaml` and exclude draft pull requests.

The relay acts as a control-plane boundary:
1. Every review is keyed by `repository + pull_request + head_sha`.
2. A new head SHA invalidates any previous review state.
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

Reviewers must never execute untrusted pull-request code.

## Merge Policy

- Green CI alone does not constitute architectural approval.
- High-risk changes (Gmail OAuth scopes, token handling, outbound actions, destructive operations) require escalation.
- No PR may be merged with unresolved review blockers.

# AI Review Relay

## Purpose

The repository prepares every non-draft PR for automated AI review. The GitHub workflow is the handoff layer: it identifies the PR, records the exact head SHA, and starts the provider-neutral review lifecycle.

## Current reviewer

**CodeRabbit is the active reviewer adapter for SuperMail.**

SuperMail is a public repository, so the current workflow is designed around CodeRabbit's public-repository/OSS review availability. The repository configuration lives in `.coderabbit.yaml`.

CodeRabbit may post a native GitHub review, including approval or requested changes when the configured review workflow permits it.

The relay must still validate the review as development control-plane input: trusted reviewer identity, repository, PR number, current head SHA, CI state, and linked issue.

## Provider boundary

The relay contract is provider-neutral. The active provider is CodeRabbit, but the dispatcher must not depend on CodeRabbit-specific wording, comments, or UI behavior.

A future provider such as a ChatGPT event-triggered task or a self-hosted/free model-backed reviewer can replace the CodeRabbit adapter without redesigning the dispatcher.

## Review input

The reviewer should read:

- repository instructions
- linked issue and acceptance criteria
- PR body
- complete diff
- current CI state
- architecture guidance
- security policy
- previous review state for the current head SHA

The reviewer must never execute untrusted pull-request code merely to inspect the change.

## Review result contract

The reviewer returns exactly one primary outcome:

- approved
- changes_requested
- escalate

A successful review must also record the reviewed head SHA. A new commit invalidates the previous review.

## Merge policy

Approved low-risk changes may enter the normal automatic merge path once the repository's merge gate is configured. High-risk changes must use the escalation path.

High-risk examples include Gmail OAuth scopes, token handling, outbound mail sending, destructive mailbox actions, attachment/network handling, policy changes, and production permissions.

## Event boundary

GitHub natively exposes pull-request review activity through the `pull_request_review` workflow event, including submitted reviews. The relay should consume the structured review event rather than parsing arbitrary PR comments.

This keeps the chain deterministic:

PR head -> CodeRabbit review -> GitHub review event -> relay validates identity/head SHA -> dispatcher state transition.

## Future ChatGPT adapter

Issue #7 tracks an optional ChatGPT Work event-triggered adapter. It is **not a dependency for the current SuperMail roadmap** and must remain an adapter replacement rather than becoming a second review state machine.

## Security notes

Reviewer output is untrusted until validated by the relay. The relay must not allow a comment, issue body, PR text, or email content to override repository policy, reviewer identity rules, merge requirements, or tool permissions.

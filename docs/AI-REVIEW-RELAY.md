# AI Review Relay

## Purpose

The repository prepares every non-draft PR for automated AI review. The GitHub workflow is intentionally only the handoff layer: it labels the PR and records the exact head SHA.

## Target integration

The intended next layer is a ChatGPT event-triggered GitHub task that watches the ai-review handoff and performs the review described in docs/AGENT.md.

The reviewer should read the repository instructions, linked issue, PR body, complete diff, CI state, architecture, security policy, and previous review state for the current head SHA.

## Review result contract

The reviewer returns exactly one primary outcome:

- approved
- changes_requested
- escalate

A successful review should also record the reviewed head SHA. A new commit invalidates the previous review.

## Merge policy

Approved low-risk changes may enter the normal automatic merge path once the repository's merge gate is configured. High-risk changes must use the escalation path.

High-risk examples include Gmail OAuth scopes, token handling, outbound mail sending, destructive mailbox actions, attachment/network handling, policy changes, and production permissions.

## Current limitation

This repository can prepare and mark review events itself. The actual ChatGPT event subscription is an account/platform integration concern and is not hard-coded into the application. Keeping that boundary means SuperMail does not become dependent on one specific ChatGPT automation implementation.

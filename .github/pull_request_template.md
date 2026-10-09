## Change

<!-- Link the issue and explain the change. -->

## Status and handoff

- **Status:** `IN PROGRESS`, `BLOCKED`, or `READY FOR REVIEW`
- **Current head SHA:** <!-- exact SHA; disclose if the latest commit changes zero files -->
- **Changed files:** <!-- list paths and briefly explain substantive changes -->
- **Remaining blockers/risks:** <!-- list unresolved issues; do not hide known gaps because CI is green -->
- **Next action / owner:** <!-- what happens next, and who owns it -->

## Acceptance criteria

<!-- Check each criterion only when verified against the current code. Keep incomplete items unchecked. -->

## Verification

- [ ] `npm test` — result and CI link for exact head SHA
- [ ] `npm run lint` — result and CI link for exact head SHA
- [ ] `npm run typecheck` — result and CI link for exact head SHA
- [ ] `npm run build` — result and CI link for exact head SHA
- [ ] Security impact considered
- [ ] Documentation updated when behavior or architecture changes
- [ ] No secrets or real mailbox data included
- [ ] No unrelated scope added

## Blocker / dead-end report

<!-- If blocked or if a bug/instruction conflict is found, explain: what was attempted; the observed error/evidence; impact on acceptance criteria; alternatives considered; the specific decision/help needed; and the safest next step. Update both this PR body and the conversation when the blocker is discovered. -->

## Agent handoff

For Jules implementations, include explicit @Jules instructions and exact validation commands. Treat this PR body as a live status ledger: update it when work starts, after meaningful progress, immediately when blocked, and before requesting review. Never use empty/no-op commits as a progress signal. If a commit changes zero files, disclose that explicitly and do not claim implementation progress. Report validation against the exact head SHA; a green CI run does not excuse undisclosed blockers.

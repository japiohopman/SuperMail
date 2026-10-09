## Change

- **Governing issue:** #...
- **Goal and scope completed:** Summarize the actual implementation, not intended future work.

## Status and handoff

- **Status:** IN PROGRESS, BLOCKED, or READY FOR REVIEW
- **Current head SHA:** exact 40-character SHA of the current PR head
- **Changed files:** Listed below; each actual changed path and its substantive purpose must be described.
  - `path/to/file` — what changed and why
- **Remaining blockers/risks:** State known remaining issues, or explicitly say none.
- **Next action / owner:** One concrete next step and the person/agent responsible.

## Acceptance criteria

- [ ] Copy each testable acceptance criterion from the governing issue and check it only when verified against the current code.

## Verification

- [ ] npm test — pending; replace with pass/fail, exact current head SHA, and a successful CI run URL.
- [ ] npm run lint — pending; replace with pass/fail, exact current head SHA, and a successful CI run URL.
- [ ] npm run typecheck — pending; replace with pass/fail, exact current head SHA, and a successful CI run URL.
- [ ] npm run build — pending; replace with pass/fail, exact current head SHA, and a successful CI run URL.
- [ ] Security impact considered and described.
- [ ] Documentation updated when behavior or architecture changes.
- [ ] No secrets, OAuth tokens, or real mailbox data included.
- [ ] No unrelated scope added.

## Blocker / dead-end report

For a blocker, include **Attempted**, **Observed evidence**, **Acceptance criteria affected**, **Alternatives considered**, **Decision or help needed**, and **Safest next step**. If no blocker is known, explicitly write: “None known; no unresolved dead end or access limitation is being hidden.”

## Latest reviewer instruction

- **Required changes:** None received yet, or list the concrete requested fixes.
- **Verification required:** State the exact commands or behavior to re-verify.
- **Do not change:** List protected boundaries and out-of-scope areas.
- **Completion signal:** State what evidence makes this review request complete.

## Safety

Describe the security/privacy impact, permissions or secrets touched (or confirm none), and whether the PR touches Gmail/runtime behavior. Never include secrets or real message content.

## Agent handoff

Treat this PR body as the live status ledger. Update it when work starts, after substantive progress, immediately when blocked, and before requesting review. A non-draft PR must report READY FOR REVIEW, have all acceptance criteria checked, and link each required verification command to a successful CI run for the exact current head. The PR Contract Gate checks this automatically; see `docs/PR-CONTRACT.md`.

If blocked, do not create repeated empty commits. Report the actual command/action, evidence/error, impact, alternatives, decision needed, and safest next step in both the PR body and a concise conversation comment. Do not merge, enable automatic dispatch, or silently take the next roadmap issue.

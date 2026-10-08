# Development Dispatcher Contract

## State machine

The dispatcher exposes explicit states across the full issue lifecycle:

`roadmap-ready` -> `claimed` -> `in-progress` -> `PR` -> `awaiting-review` -> `changes-requested` / `approved` -> `merged`

Valid state transitions enforced by the dispatcher engine:
- `roadmap-ready` -> `claimed`
- `claimed` -> `in-progress`, `roadmap-ready`
- `in-progress` -> `PR`, `awaiting-review`, `roadmap-ready`
- `PR` -> `awaiting-review`, `changes-requested`, `in-progress`
- `awaiting-review` -> `approved`, `changes-requested`
- `changes-requested` -> `in-progress`, `awaiting-review`, `PR`
- `approved` -> `merged`, `changes-requested`
- `merged` -> terminal state

## Claim identity

Every implementation session has a stable claim identity formatted as:
`jules-<timestamp>-<issueNumber>-<nonce>`

The dispatcher engine prevents duplicate claims by checking if an issue is already claimed or in-progress. If an active claim exists on an issue, attempts by another worker to claim the same issue fail immediately.

## State persistence format

Dispatcher state is stored in a single explicit repository state file (e.g. `.github/dispatcher-state.json` or custom path). The schema is structured as follows:

```json
{
  "version": "1.0.0",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "issues": {
    "3": {
      "issueId": "3",
      "title": "Build durable development dispatcher state engine",
      "body": "Turn current dispatcher contract into real dependency-aware orchestrator...",
      "prerequisites": ["1"],
      "acceptanceCriteria": [
        "Persist dispatcher queue state in a single explicit repository state format.",
        "Claim roadmap-ready issues with a stable claimId and prevent duplicate claims."
      ],
      "likelyModules": [".github/supermail-dispatcher.mjs"],
      "securityImpact": "Development-plane only.",
      "repositoryInstructions": "See AGENTS.md and docs/DISPATCH.md",
      "validationCommands": [
        "npm test",
        "npm run lint",
        "npm run typecheck",
        "npm run build"
      ],
      "status": "claimed",
      "claim": {
        "claimId": "jules-1700000000000-3-worker1",
        "sessionId": "session-worker1",
        "claimedAt": "2025-01-01T00:00:00.000Z",
        "expiresAt": "2025-01-01T01:00:00.000Z",
        "lastHeartbeat": "2025-01-01T00:00:00.000Z"
      }
    }
  },
  "sessions": {
    "jules-1700000000000-3-worker1": {
      "claimId": "jules-1700000000000-3-worker1",
      "issueId": "3",
      "status": "claimed",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "expiresAt": "2025-01-01T01:00:00.000Z",
      "pullRequest": null,
      "headSha": null
    }
  }
}
```

Because state is saved to disk atomically, a process restart or crash reloads per-session state and prevents silent duplication of work.

## Dependency ordering rules

An issue cannot be claimed or dispatched if any issue listed in its `prerequisites` array is not in the `merged` state. If prerequisites are incomplete, `claimIssue()` throws a dependency error identifying the unmerged prerequisite issue IDs.

## Jules handoff packet

The dispatcher generates a deterministic handoff packet containing:
1. Issue details (`issueId`, `title`, `body`, `status`)
2. Acceptance criteria array
3. Prerequisites & `dependencyStatus` (`satisfied` or `blocked`)
4. Repository instructions (pointing to `AGENTS.md` and `docs/DISPATCH.md`)
5. Required validation commands:
   - `npm test`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
6. Explicit `@jules` prompt instructions enforcing scope boundaries and hard constraints.

## Operational recovery for stuck sessions

If a Jules runner process crashes, hangs, or encounters an unrecoverable failure:

1. **Automatic Lease Expiration:**
   - Every claim is issued with a lease duration (default: 1 hour).
   - Upon claiming or recovering state, `recoverStaleClaims()` automatically identifies claims where `currentTime > expiresAt`, marks the session as `stale-recovered`, and resets the issue status back to `roadmap-ready`.

2. **Manual Session Release / Reset:**
   - Call `engine.releaseClaim(claimId, "manual operational recovery")` in Node or dispatcher CLI.
   - This sets the corresponding issue back to `roadmap-ready`, clears `issue.claim`, and records the release reason in session status.

3. **Session Re-claiming:**
   - Once an issue is reset to `roadmap-ready`, a new dispatcher instance or session can safely claim the issue with a new stable `claimId`.

## Review identity

Every AI review is keyed by repository + pull request + head SHA:
`${repository}#${pullRequest}@${headSha}`
A new head SHA requires a new review.

## The dispatcher must not

Invent requirements; bypass security; merge PRs; silently reorder hard dependencies; retry stuck tasks forever; or treat green CI as architectural approval.

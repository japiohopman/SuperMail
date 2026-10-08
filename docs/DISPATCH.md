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

## Core Invariants

1. **Strict Claim Invariant:**
   `claimIssue()` may claim an issue **only** when its current status is strictly `"roadmap-ready"`. Attempting to claim an issue in any other state (e.g., `claimed`, `in-progress`, `PR`, `merged`) is strictly rejected, regardless of whether a claim object exists.

2. **Strict State/Claim Invariant:**
   `"roadmap-ready"` (and `"merged"`) must **never** coexist with an active claim or session. Any release, reset, or transition back to `"roadmap-ready"` clears the issue claim and associated session atomically.

3. **Register Safety:**
   `registerIssue()` validates existing state transitions and prevents registering or updating an issue into an impossible or corrupt state/claim combination.

4. **No Ambient Randomness:**
   Dispatcher control-plane identifiers (nonces, temporary filenames, unique tags) use cryptographic primitives (`crypto.randomBytes()`) rather than pseudo-random functions like `Math.random()`.

## Persistence Adapter Boundary & Concurrency Control

### Persistence Boundaries
Local JSON file state on a GitHub Actions runner is an ephemeral execution artifact, **not** durable shared orchestration state across isolated workflow invocations or independent runner environments.

To maintain clean separation of concerns:
- **`DispatcherEngine`**: Pure state machine and lifecycle invariant engine.
- **`PersistenceAdapter`**: Abstract storage contract defining `load()` and `save(state, expectedRevision)`.
- **`FilePersistenceAdapter`**: Default local file persistence adapter with Compare-And-Swap (CAS) revision checking.
- **`MemoryPersistenceAdapter`**: In-memory adapter with CAS revision checking for testing and process-isolated workflows.
- **Shared Orchestration Layer (#6)**: Future persistent adapter providing cross-runner durability (e.g., GitHub State API / issue store / central store).

### Concurrency Guarantees (CAS / Optimistic Locking)
Every state modification increments an explicit integer `revision`. Persistence adapters enforce Compare-And-Swap (CAS):
- When saving, the adapter checks whether the current store revision matches the expected revision loaded before the modification.
- If two processes attempt concurrent claims or state transitions on the same initial revision, the second write fails with a CAS conflict (`CAS conflict: expected revision X, but current is Y`).

## State schema format

```json
{
  "version": "1.0.0",
  "revision": 1,
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
        "claimId": "jules-1700000000000-3-a1b2c3d4",
        "sessionId": "session-a1b2c3d4",
        "claimedAt": "2025-01-01T00:00:00.000Z",
        "expiresAt": "2025-01-01T01:00:00.000Z",
        "lastHeartbeat": "2025-01-01T00:00:00.000Z"
      }
    }
  },
  "sessions": {
    "jules-1700000000000-3-a1b2c3d4": {
      "claimId": "jules-1700000000000-3-a1b2c3d4",
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

1. **Automatic Lease Expiration:**
   - Claims are issued with a lease duration (default: 1 hour).
   - `recoverStaleClaims()` automatically identifies expired claims (`now > expiresAt`), updates session status to `stale-recovered`, and resets the issue status back to `roadmap-ready` while clearing `issue.claim`.

2. **Manual Session Release / Reset:**
   - Calling `engine.releaseClaim(claimId, "operational recovery")` sets the issue back to `roadmap-ready` and atomically clears `issue.claim`.

3. **Session Re-claiming:**
   - Once reset to `roadmap-ready`, the issue can be safely claimed by a new session.

## Review identity

Every AI review is keyed by repository + pull request + head SHA:
`${repository}#${pullRequest}@${headSha}`
A new head SHA requires a new review.

## The dispatcher must not

Invent requirements; bypass security; merge PRs; silently reorder hard dependencies; retry stuck tasks forever; or treat green CI as architectural approval.

# Development Dispatcher Contract

## State machine

roadmap-ready -> claimed -> in-progress -> PR -> awaiting-review -> approved/changes-requested -> merged

## Claim identity

Every implementation session has a stable identity such as jules-<timestamp>-<issue>-<nonce>. State must prevent two dispatchers from claiming the same issue concurrently.

## Review identity

Every AI review is keyed by repository + pull request + head SHA. A new head SHA requires a new review.

## Roadmap-ready rules

An issue is roadmap-ready only when prerequisites are known, acceptance criteria are testable, likely modules are identified, security impact is understood, and the task is small enough for one Jules session.

## The dispatcher must not

Invent requirements; bypass security; merge PRs; silently reorder hard dependencies; retry stuck tasks forever; or treat green CI as architectural approval.

## Jules adapter

The future Jules handoff packet contains issue number, title/body, dependency status, repository instructions, required validation commands, and explicit @Jules instructions. Jules integration remains an adapter boundary so roadmap logic does not depend on one vendor.

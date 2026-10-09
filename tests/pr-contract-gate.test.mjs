import test from "node:test";
import assert from "node:assert/strict";
import { validatePrContract } from "../.github/scripts/pr-contract-gate.mjs";

const HEAD = "a".repeat(40);
const FILES = [".github/workflows/pr-contract-gate.yml", ".github/scripts/pr-contract-gate.mjs"];
const CI_URL = "https://github.com/japiohopman/SuperMail/actions/runs/12345";

function validInput(overrides = {}) {
  const lines = [
    "## Change",
    "- **Governing issue:** #13",
    "Issue #2 workflow foundation and communication enforcement.",
    "",
    "## Status and handoff",
    "- **Status:** READY FOR REVIEW",
    "- **Current head SHA:** " + HEAD,
    "- **Changed files:** Listed below; paths and substantive changes are documented.",
    "- " + FILES[0] + " — adds the trusted-base PR gate.",
    "- " + FILES[1] + " — validates the PR contract.",
    "- **Remaining blockers/risks:** None known; the gate checks metadata and trusted base-branch code only.",
    "- **Next action / owner:** Reviewer validates the current diff; maintainer owns merge.",
    "",
    "## Acceptance criteria",
    "- [x] PR status matches the current head.",
    "- [x] Actual changed file paths are listed.",
    "- [x] Required validation and handoff fields are present.",
    "",
    "## Verification",
    "- [x] npm test — passed on head SHA " + HEAD + "; CI: " + CI_URL,
    "- [x] npm run lint — passed on head SHA " + HEAD + "; CI: " + CI_URL,
    "- [x] npm run typecheck — passed on head SHA " + HEAD + "; CI: " + CI_URL,
    "- [x] npm run build — passed on head SHA " + HEAD + "; CI: " + CI_URL,
    "- [x] Security impact considered.",
    "- [x] Documentation updated.",
    "- [x] No secrets or real mailbox data included.",
    "- [x] No unrelated scope added.",
    "",
    "## Blocker / dead-end report",
    "None known. No access limitation or unresolved dead end is being hidden.",
    "",
    "## Latest reviewer instruction",
    "- **Required changes:** None received yet.",
    "- **Verification required:** Review the latest diff and current-head CI.",
    "- **Do not change:** Gmail runtime scopes, secrets, or unrelated dispatcher behavior.",
    "- **Completion signal:** Required review passes on the exact head SHA and no requests remain.",
    "",
    "## Safety",
    "Development-plane only. The workflow uses read-only GitHub permissions, checks out only the base revision, and never executes PR-head code. No Gmail credentials or mailbox contents are introduced."
  ];
  return {
    body: lines.join("\n"),
    draft: false,
    headSha: HEAD,
    changedFiles: FILES,
    governingIssueIsValid: true,
    verifiedCiRunIds: ["12345"],
    lastCommitTreeIdenticalToParent: false,
    noOpInspectionFailed: false,
    ...overrides,
  };
}

test("accepts a complete, current contract backed by successful CI for its head SHA", () => {
  const result = validatePrContract(validInput());
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("rejects a missing or non-open governing issue", () => {
  const missing = validatePrContract(validInput({ body: validInput().body.replace("- **Governing issue:** #13", "- **Governing issue:** TBD") }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes("Governing issue must be the number")));

  const closed = validatePrContract(validInput({ governingIssueIsValid: false }));
  assert.equal(closed.ok, false);
  assert.ok(closed.errors.some((error) => error.includes("must exist, remain open")));
});

test("skips draft PRs so work in progress can remain incomplete", () => {
  const result = validatePrContract(validInput({ draft: true, body: "" }));
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("rejects a stale PR-body head SHA", () => {
  const result = validatePrContract(validInput({ body: validInput().body.replace(HEAD, "b".repeat(40)) }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("head SHA is stale")));
});

test("rejects missing actual changed-file paths", () => {
  const result = validatePrContract(validInput({ body: validInput().body.replace(FILES[0], "different.yml") }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("missing path: " + FILES[0])));
});

test("rejects unchecked acceptance criteria and validation", () => {
  const body = validInput().body
    .replace("- [x] Actual changed file paths are listed.", "- [ ] Actual changed file paths are listed.")
    .replace("- [x] npm run lint", "- [ ] npm run lint");
  const result = validatePrContract(validInput({ body }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("All acceptance criteria must be checked")));
  assert.ok(result.errors.some((error) => error.includes("All required verification")));
});

test("rejects a no-op head commit even when the PR body looks complete", () => {
  const result = validatePrContract(validInput({ lastCommitTreeIdenticalToParent: true }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("no-op commit")));
});

test("rejects missing or failed required command evidence", () => {
  const body = validInput().body.replace(
    "- [x] npm run build — passed on head SHA " + HEAD + "; CI: " + CI_URL,
    "- [x] npm run build — failed on head SHA " + HEAD
  );
  const result = validatePrContract(validInput({ body }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("npm run build as passed")));
});

test("rejects a CI link that is not verified for the current head", () => {
  const result = validatePrContract(validInput({ verifiedCiRunIds: [] }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => error.includes("successful CI run on the current head")).length, 4);
});

test("fails closed when commit-tree inspection cannot be completed", () => {
  const result = validatePrContract(validInput({ noOpInspectionFailed: true }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Unable to verify")));
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  DispatcherEngine,
  isValidState,
  isValidTransition,
  makeClaimId,
  makeReviewKey,
  STATES
} from "../.github/supermail-dispatcher.mjs";

function getTempStateFilePath() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-test-"));
  return path.join(tmpDir, "dispatcher-state.json");
}

test("isValidState and isValidTransition", () => {
  assert.equal(isValidState("claimed"), true);
  assert.equal(isValidState("invalid-state"), false);

  assert.equal(isValidTransition("roadmap-ready", "claimed"), true);
  assert.equal(isValidTransition("claimed", "in-progress"), true);
  assert.equal(isValidTransition("claimed", "merged"), false);
  assert.equal(isValidTransition("in-progress", "PR"), true);
  assert.equal(isValidTransition("PR", "awaiting-review"), true);
  assert.equal(isValidTransition("awaiting-review", "approved"), true);
  assert.equal(isValidTransition("approved", "merged"), true);
});

test("makeClaimId and makeReviewKey format", () => {
  const claimId = makeClaimId("3", "testnonce", 1700000000000);
  assert.equal(claimId, "jules-1700000000000-3-testnonce");

  const reviewKey = makeReviewKey("owner/repo", "42", "abc1234");
  assert.equal(reviewKey, "owner/repo#42@abc1234");
});

test("duplicate claim prevention", () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });

  engine.registerIssue({
    issueId: "1",
    title: "Foundation PR",
    status: "merged"
  });

  engine.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    prerequisites: ["1"],
    status: "roadmap-ready"
  });

  const claim1 = engine.claimIssue("3", { nonce: "worker-1" });
  assert.ok(claim1.claimId.includes("worker-1"));
  assert.equal(engine.getIssue("3").status, "claimed");

  assert.throws(() => {
    engine.claimIssue("3", { nonce: "worker-2" });
  }, /already claimed by claimId/);
});

test("dependency blocking before dispatch", () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });

  engine.registerIssue({
    issueId: "1",
    title: "Foundation PR",
    status: "roadmap-ready" // Not merged!
  });

  engine.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    prerequisites: ["1"],
    status: "roadmap-ready"
  });

  assert.throws(() => {
    engine.claimIssue("3", { nonce: "worker-1" });
  }, /Prerequisite issues not merged: 1/);

  // Now merge issue 1
  engine.updateStatus("1", "claimed");
  engine.updateStatus("1", "in-progress");
  engine.updateStatus("1", "PR");
  engine.updateStatus("1", "awaiting-review");
  engine.updateStatus("1", "approved");
  engine.updateStatus("1", "merged");

  const claim = engine.claimIssue("3", { nonce: "worker-1" });
  assert.equal(claim.issue.status, "claimed");
});

test("stale claim recovery", () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath, leaseDurationMs: 1000 }); // 1 sec lease

  engine.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    prerequisites: [],
    status: "roadmap-ready"
  });

  const now = 1000000;
  engine.claimIssue("3", { nonce: "worker-1", nowMs: now });

  // Right before expiry, claim should throw duplicate error
  assert.throws(() => {
    engine.claimIssue("3", { nonce: "worker-2", nowMs: now + 500 });
  }, /already claimed/);

  // After lease duration expires, stale claim recovery enables worker-2 to claim
  const claim2 = engine.claimIssue("3", { nonce: "worker-2", nowMs: now + 1001 });
  assert.ok(claim2.claimId.includes("worker-2"));
  assert.equal(engine.getIssue("3").status, "claimed");
});

test("persistence across process restarts", () => {
  const filePath = getTempStateFilePath();

  // Process 1 writes state
  const engine1 = new DispatcherEngine({ filePath });
  engine1.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    acceptanceCriteria: ["Persist dispatcher state"],
    status: "roadmap-ready"
  });
  const claim1 = engine1.claimIssue("3", { nonce: "session-abc" });
  engine1.updateStatus("3", "in-progress");

  // Process 2 loads state from disk
  const engine2 = new DispatcherEngine({ filePath });
  const issue = engine2.getIssue("3");
  assert.equal(issue.status, "in-progress");
  assert.equal(issue.claim.claimId, claim1.claimId);
  assert.deepEqual(issue.acceptanceCriteria, ["Persist dispatcher state"]);

  const session = engine2.getSession(claim1.claimId);
  assert.equal(session.issueId, "3");
  assert.equal(session.status, "in-progress");
});

test("deterministic Jules handoff packet generation", () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });

  engine.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    body: "Build durable state engine",
    acceptanceCriteria: [
      "Persist dispatcher queue state in a single explicit repository state format.",
      "Claim roadmap-ready issues with a stable claimId and prevent duplicate claims."
    ],
    prerequisites: [],
    status: "roadmap-ready"
  });

  const packet = engine.generateHandoffPacket("3");
  assert.deepEqual(packet, {
    issue: {
      issueId: "3",
      title: "Dispatcher state engine",
      body: "Build durable state engine",
      status: "roadmap-ready"
    },
    acceptanceCriteria: [
      "Persist dispatcher queue state in a single explicit repository state format.",
      "Claim roadmap-ready issues with a stable claimId and prevent duplicate claims."
    ],
    prerequisites: [],
    dependencyStatus: "satisfied",
    repositoryInstructions: "See AGENTS.md and docs/DISPATCH.md",
    validationCommands: [
      "npm test",
      "npm run lint",
      "npm run typecheck",
      "npm run build"
    ],
    julesInstructions: "@jules Implement issue #3 (Dispatcher state engine). Treat docs/DISPATCH.md and AGENTS.md as hard constraints. Keep the dispatcher separate from the SuperMail runtime agent. Add tests and documentation, and report the exact validation commands in the PR."
  });
});

test("all required states exposed and valid transitions enforced", () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });

  engine.registerIssue({
    issueId: "10",
    title: "Test State Transitions",
    status: "roadmap-ready"
  });

  const statesSequence = [
    "claimed",
    "in-progress",
    "PR",
    "awaiting-review",
    "changes-requested",
    "in-progress",
    "awaiting-review",
    "approved",
    "merged"
  ];

  // First claim
  engine.claimIssue("10");

  // Subsequent transitions
  for (let i = 1; i < statesSequence.length; i++) {
    const nextState = statesSequence[i];
    engine.updateStatus("10", nextState);
    assert.equal(engine.getIssue("10").status, nextState);
  }

  // Verify error when attempting invalid transition from merged
  assert.throws(() => {
    engine.updateStatus("10", "claimed");
  }, /Invalid state transition/);
});

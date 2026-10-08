import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  DispatcherEngine,
  FilePersistenceAdapter,
  MemoryPersistenceAdapter,
  isValidState,
  isValidTransition,
  makeClaimId,
  makeReviewKey
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

test("strict claim invariant: claiming non-roadmap-ready issue is rejected", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  await engine.registerIssue({ issueId: "1", status: "roadmap-ready" });
  await engine.claimIssue("1", { nonce: "setup" });
  await engine.updateStatus("1", "in-progress");
  await engine.updateStatus("1", "PR");
  await engine.updateStatus("1", "awaiting-review");
  await engine.updateStatus("1", "approved");
  await engine.updateStatus("1", "merged");

  await engine.registerIssue({ issueId: "3", prerequisites: ["1"], status: "roadmap-ready" });

  await engine.claimIssue("3", { nonce: "worker-1" });
  assert.equal(engine.getIssue("3").status, "claimed");

  // Attempt to claim issue 3 when it's already in 'claimed' state
  await assert.rejects(
    async () => { await engine.claimIssue("3", { nonce: "worker-2" }); },
    /must be exactly 'roadmap-ready'/
  );

  // Transition to in-progress
  await engine.updateStatus("3", "in-progress");
  await assert.rejects(
    async () => { await engine.claimIssue("3", { nonce: "worker-3" }); },
    /must be exactly 'roadmap-ready'/
  );

  // Attempt to claim merged issue 1
  await assert.rejects(
    async () => { await engine.claimIssue("1", { nonce: "worker-4" }); },
    /must be exactly 'roadmap-ready'/
  );
});

test("strict state/claim invariant: roadmap-ready status cannot retain active claim or session", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  await engine.registerIssue({ issueId: "3", status: "roadmap-ready" });
  const { claimId } = await engine.claimIssue("3", { nonce: "worker-1" });

  assert.ok(engine.getIssue("3").claim);
  assert.equal(engine.getSession(claimId).status, "claimed");

  // Release claim back to roadmap-ready
  await engine.releaseClaim(claimId, "manual reset");

  const issue = engine.getIssue("3");
  assert.equal(issue.status, "roadmap-ready");
  assert.equal(issue.claim, null);

  // Session must move to terminal/reset status
  const session = engine.getSession(claimId);
  assert.equal(session.status, "released: manual reset");

  // Re-registering issue in roadmap-ready status must not reinstate claim
  await engine.registerIssue({ issueId: "3", status: "roadmap-ready" });
  assert.equal(engine.getIssue("3").claim, null);
});

test("releaseClaim safety: rejecting stale or wrong claim IDs without mutating state", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  await engine.registerIssue({ issueId: "7", status: "roadmap-ready" });
  const { claimId: activeClaimId } = await engine.claimIssue("7", { nonce: "active-runner" });

  // Attempt to release using an unassociated or stale claim ID
  await assert.rejects(
    async () => { await engine.releaseClaim("jules-999-7-stalerunner", "stale reset"); },
    /Session with claimId jules-999-7-stalerunner not found/
  );

  // Issue status and active claim must remain unchanged
  const issue = engine.getIssue("7");
  assert.equal(issue.status, "claimed");
  assert.equal(issue.claim.claimId, activeClaimId);
});

test("updateStatus safety: rejecting claim-requiring status without active claim", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  await engine.registerIssue({ issueId: "8", status: "roadmap-ready" });

  // Attempting to directly updateStatus to 'claimed' or 'in-progress' without an active claim must fail
  await assert.rejects(
    async () => { await engine.updateStatus("8", "claimed"); },
    /without an active claim/
  );

  // Create issue in claimed status via claimIssue, then remove claim manually from state
  await engine.claimIssue("8", { nonce: "worker" });
  engine.state.issues["8"].claim = null;
  await engine.save();

  // Now in 'claimed' status but without claim structure
  await assert.rejects(
    async () => { await engine.updateStatus("8", "in-progress"); },
    /without an active claim/
  );
});

test("registerIssue safety: rejecting claim-requiring states when no claim exists", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  // Attempt to register a new issue directly in 'claimed' or 'in-progress' without a claim
  await assert.rejects(
    async () => { await engine.registerIssue({ issueId: "10", status: "claimed" }); },
    /without an active claim/
  );

  await assert.rejects(
    async () => { await engine.registerIssue({ issueId: "10", status: "in-progress" }); },
    /without an active claim/
  );

  await assert.rejects(
    async () => { await engine.registerIssue({ issueId: "10", status: "PR" }); },
    /without an active claim/
  );
});

test("dependency blocking before dispatch", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  await engine.registerIssue({
    issueId: "1",
    title: "Foundation PR",
    status: "roadmap-ready" // Not merged!
  });

  await engine.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    prerequisites: ["1"],
    status: "roadmap-ready"
  });

  await assert.rejects(
    async () => { await engine.claimIssue("3", { nonce: "worker-1" }); },
    /Prerequisite issues not merged: 1/
  );

  // Now merge issue 1
  await engine.claimIssue("1", { nonce: "worker-1" });
  await engine.updateStatus("1", "in-progress");
  await engine.updateStatus("1", "PR");
  await engine.updateStatus("1", "awaiting-review");
  await engine.updateStatus("1", "approved");
  await engine.updateStatus("1", "merged");

  const claim = await engine.claimIssue("3", { nonce: "worker-1" });
  assert.equal(claim.issue.status, "claimed");
});

test("stale claim recovery", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath, leaseDurationMs: 1000 }); // 1 sec lease
  await engine.init();

  await engine.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    status: "roadmap-ready"
  });

  const now = 1000000;
  await engine.claimIssue("3", { nonce: "worker-1", nowMs: now });

  // Right before expiry, claim should throw status error
  await assert.rejects(
    async () => { await engine.claimIssue("3", { nonce: "worker-2", nowMs: now + 500 }); },
    /must be exactly 'roadmap-ready'/
  );

  // After lease duration expires, stale claim recovery enables worker-2 to claim
  const claim2 = await engine.claimIssue("3", { nonce: "worker-2", nowMs: now + 1001 });
  assert.ok(claim2.claimId.includes("worker-2"));
  assert.equal(engine.getIssue("3").status, "claimed");
});

test("genuinely concurrent claim race with separate FilePersistenceAdapter instances: exactly one claim succeeds", async () => {
  const filePath = getTempStateFilePath();

  // Setup initial issue state
  const initEngine = new DispatcherEngine({ adapter: new FilePersistenceAdapter(filePath) });
  await initEngine.init();
  await initEngine.registerIssue({ issueId: "42", status: "roadmap-ready" });

  // Spawn 5 independent runner engines, each with its OWN FilePersistenceAdapter instance
  const promises = Array.from({ length: 5 }, (_, i) => {
    const adapter = new FilePersistenceAdapter(filePath);
    const runnerEngine = new DispatcherEngine({ adapter });
    return runnerEngine.claimIssue("42", { nonce: `runner-${i}` });
  });

  const results = await Promise.allSettled(promises);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 4);

  // Verify the rejected calls failed with either claim status error or CAS conflict
  for (const r of rejected) {
    assert.ok(
      /must be exactly 'roadmap-ready'|CAS conflict/.test(r.reason.message),
      `Unexpected failure reason: ${r.reason.message}`
    );
  }
});

test("FilePersistenceAdapter handles malformed state JSON by throwing syntax error", async () => {
  const filePath = getTempStateFilePath();
  fs.writeFileSync(filePath, "{ invalid json ...", "utf8");

  const adapter = new FilePersistenceAdapter(filePath);
  await assert.rejects(
    async () => { await adapter.load(); },
    /Malformed dispatcher state file/
  );
});

test("registerIssue safety against invalid state transitions", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  await engine.registerIssue({ issueId: "5", status: "roadmap-ready" });
  await engine.claimIssue("5", { nonce: "worker-1" });
  await engine.updateStatus("5", "in-progress");

  // Attempt to re-register issue 5 with invalid state transition (in-progress -> merged directly)
  await assert.rejects(
    async () => { await engine.registerIssue({ issueId: "5", status: "merged" }); },
    /invalid state transition from in-progress to merged/
  );

  // Registering with roadmap-ready status clears active claim and moves session to reset
  await engine.registerIssue({ issueId: "5", status: "roadmap-ready" });
  assert.equal(engine.getIssue("5").status, "roadmap-ready");
  assert.equal(engine.getIssue("5").claim, null);
});

test("persistence behavior remains correct across engine instances", async () => {
  const filePath = getTempStateFilePath();

  // Instance 1 writes state
  const engine1 = new DispatcherEngine({ filePath });
  await engine1.init();
  await engine1.registerIssue({
    issueId: "3",
    title: "Dispatcher state engine",
    acceptanceCriteria: ["Persist dispatcher state"],
    status: "roadmap-ready"
  });
  const claim1 = await engine1.claimIssue("3", { nonce: "session-abc" });
  await engine1.updateStatus("3", "in-progress");

  // Instance 2 loads state from disk
  const engine2 = new DispatcherEngine({ filePath });
  await engine2.init();
  const issue = engine2.getIssue("3");
  assert.equal(issue.status, "in-progress");
  assert.equal(issue.claim.claimId, claim1.claimId);
  assert.deepEqual(issue.acceptanceCriteria, ["Persist dispatcher state"]);

  const session = engine2.getSession(claim1.claimId);
  assert.equal(session.issueId, "3");
  assert.equal(session.status, "in-progress");
});

test("deterministic Jules handoff packet generation", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath });
  await engine.init();

  await engine.registerIssue({
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

test("MemoryPersistenceAdapter contract and CAS locking", async () => {
  const memoryAdapter = new MemoryPersistenceAdapter();
  const engine1 = new DispatcherEngine({ adapter: memoryAdapter });
  const engine2 = new DispatcherEngine({ adapter: memoryAdapter });

  await engine1.init();
  await engine1.registerIssue({ issueId: "10", status: "roadmap-ready" });

  await engine2.sync();

  // engine1 claims issue 10
  await engine1.claimIssue("10");

  // engine2 attempts write using stale revision
  engine2.state.issues["10"].title = "Stale write attempt";
  await assert.rejects(
    async () => { await engine2.save(); },
    /CAS conflict/
  );
});

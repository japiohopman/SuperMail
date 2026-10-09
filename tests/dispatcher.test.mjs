import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fork } from "node:child_process";

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
  const { claimId: setupClaimId } = await engine.claimIssue("1", { nonce: "setup" });
  await engine.updateStatus("1", "in-progress", { claimId: setupClaimId });
  await engine.updateStatus("1", "PR", { claimId: setupClaimId });
  await engine.updateStatus("1", "awaiting-review", { claimId: setupClaimId });
  await engine.updateStatus("1", "approved", { claimId: setupClaimId });
  await engine.updateStatus("1", "merged", { claimId: setupClaimId });

  await engine.registerIssue({ issueId: "3", prerequisites: ["1"], status: "roadmap-ready" });

  const { claimId: claim3Id } = await engine.claimIssue("3", { nonce: "worker-1" });
  assert.equal(engine.getIssue("3").status, "claimed");

  // Attempt to claim issue 3 when it's already in 'claimed' state
  await assert.rejects(
    async () => { await engine.claimIssue("3", { nonce: "worker-2" }); },
    /must be exactly 'roadmap-ready'/
  );

  // Transition to in-progress
  await engine.updateStatus("3", "in-progress", { claimId: claim3Id });
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

test("updateStatus safety: rejecting claim-owned transition without valid, non-expired claimId", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath, leaseDurationMs: 1000 });
  await engine.init();

  await engine.registerIssue({ issueId: "99", status: "roadmap-ready" });
  const now = Date.now();
  const { claimId } = await engine.claimIssue("99", { nonce: "worker-1", nowMs: now });

  // Missing claimId
  await assert.rejects(
    async () => { await engine.updateStatus("99", "in-progress"); },
    /without providing 'claimId'/
  );

  // Wrong/mismatched claimId
  await assert.rejects(
    async () => { await engine.updateStatus("99", "in-progress", { claimId: "wrong-claim-id" }); },
    /does not match active claim/
  );

  // Expired claimId
  await assert.rejects(
    async () => { await engine.updateStatus("99", "in-progress", { claimId, nowMs: now + 2000 }); },
    /has expired/
  );

  // Issue state must remain 'claimed'
  assert.equal(engine.getIssue("99").status, "claimed");

  // Valid claimId and active lease succeeds
  await engine.updateStatus("99", "in-progress", { claimId, nowMs: now + 100 });
  assert.equal(engine.getIssue("99").status, "in-progress");
});

test("heartbeatClaim safety: rejecting expired leases and recovering claim atomically", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath, leaseDurationMs: 1000 });
  await engine.init();

  await engine.registerIssue({ issueId: "50", status: "roadmap-ready" });
  const now = Date.now();
  const { claimId } = await engine.claimIssue("50", { nonce: "hb-worker", nowMs: now });

  // Extend lease before expiration succeeds
  await engine.heartbeatClaim(claimId, { nowMs: now + 500, leaseDurationMs: 1000 });
  assert.equal(engine.getIssue("50").status, "claimed");

  // Attempt to extend lease AFTER expiration fails, recovers claim to roadmap-ready, and persists recovery
  await assert.rejects(
    async () => { await engine.heartbeatClaim(claimId, { nowMs: now + 2000 }); },
    /lease has expired/
  );

  // Verify another engine instance reads recovered state from disk
  const engine2 = new DispatcherEngine({ filePath });
  await engine2.init();
  assert.equal(engine2.getIssue("50").status, "roadmap-ready");
  assert.equal(engine2.getIssue("50").claim, null);
  assert.equal(engine2.getSession(claimId).status, "stale-recovered");
});

test("claimIssue persists stale recovery even when prerequisite checks fail", async () => {
  const filePath = getTempStateFilePath();
  const engine = new DispatcherEngine({ filePath, leaseDurationMs: 1000 });
  await engine.init();

  await engine.registerIssue({ issueId: "1", status: "roadmap-ready" });
  const now = Date.now();
  const { claimId: claim1Id } = await engine.claimIssue("1", { nonce: "worker-1", nowMs: now });

  // Issue 2 depends on unmerged Issue 1
  await engine.registerIssue({ issueId: "2", prerequisites: ["1"], status: "roadmap-ready" });

  // Call claimIssue for Issue 2 at now + 2000ms.
  // Issue 1's claim has expired. claimIssue recovers Issue 1, persists recovery, then fails on Issue 2 prereqs.
  await assert.rejects(
    async () => { await engine.claimIssue("2", { nonce: "worker-2", nowMs: now + 2000 }); },
    /Prerequisite issues not merged: 1/
  );

  // Verify another engine reads recovered Issue 1 from disk
  const engine2 = new DispatcherEngine({ filePath });
  await engine2.init();
  assert.equal(engine2.getIssue("1").status, "roadmap-ready");
  assert.equal(engine2.getIssue("1").claim, null);
  assert.equal(engine2.getSession(claim1Id).status, "stale-recovered");
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

test("FilePersistenceAdapter lock ownership: stale lock holder token cannot remove replacement lock owner", async () => {
  const filePath = getTempStateFilePath();
  const adapterOwner1 = new FilePersistenceAdapter(filePath);
  const adapterOwner2 = new FilePersistenceAdapter(filePath);

  // Owner 1 acquires lock
  await adapterOwner1.acquireLock();
  assert.ok(fs.existsSync(adapterOwner1.lockPath));

  // Simulate Owner 2 replacing lock content manually or via takeover
  const owner2Token = "99999:replacementToken123";
  fs.writeFileSync(adapterOwner1.lockPath, owner2Token, "utf8");

  // Owner 1 attempts to release lock - must NOT delete Owner 2's lock file
  adapterOwner1.releaseLock();
  assert.ok(fs.existsSync(adapterOwner1.lockPath), "Replacement lock file must remain intact");
  assert.equal(fs.readFileSync(adapterOwner1.lockPath, "utf8").trim(), owner2Token);

  // Clean up
  if (fs.existsSync(adapterOwner1.lockPath)) fs.unlinkSync(adapterOwner1.lockPath);
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
  const { claimId: claim1Id } = await engine.claimIssue("1", { nonce: "worker-1" });
  await engine.updateStatus("1", "in-progress", { claimId: claim1Id });
  await engine.updateStatus("1", "PR", { claimId: claim1Id });
  await engine.updateStatus("1", "awaiting-review", { claimId: claim1Id });
  await engine.updateStatus("1", "approved", { claimId: claim1Id });
  await engine.updateStatus("1", "merged", { claimId: claim1Id });

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

test("real multi-process concurrent claim race: failure-safe child process test", async () => {
  const filePath = getTempStateFilePath();
  const tmpScript = path.join(path.dirname(filePath), "child-runner.mjs");

  try {
    // Setup initial issue state
    const initEngine = new DispatcherEngine({ filePath });
    await initEngine.init();
    await initEngine.registerIssue({ issueId: "100", status: "roadmap-ready" });

    const dispatcherModulePath = path.resolve(process.cwd(), ".github/supermail-dispatcher.mjs");

    // Child process script
    const childScript = `
      import { DispatcherEngine } from ${JSON.stringify(dispatcherModulePath)};
      const filePath = process.argv[2];
      const nonce = process.argv[3];
      async function run() {
        try {
          const engine = new DispatcherEngine({ filePath });
          await engine.init();
          const res = await engine.claimIssue('100', { nonce });
          process.send({ success: true, claimId: res.claimId });
        } catch (err) {
          process.send({ success: false, error: err.message });
        }
      }
      run();
    `;

    fs.writeFileSync(tmpScript, childScript, "utf8");

    // Spawn 4 separate OS child processes with failure-safe promise resolution
    const children = Array.from({ length: 4 }, (_, i) => {
      return new Promise((resolve) => {
        let settled = false;
        const child = fork(tmpScript, [filePath, `proc-${i}`], { stdio: "ignore" });

        const safeResolve = (data) => {
          if (!settled) {
            settled = true;
            resolve(data);
          }
        };

        child.on("message", (msg) => safeResolve(msg));
        child.on("error", (err) => safeResolve({ success: false, error: err.message }));
        child.on("exit", (code) => {
          if (!settled) {
            safeResolve({ success: false, error: `Child process exited with code ${code}` });
          }
        });
      });
    });

    const results = await Promise.all(children);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.equal(successes.length, 1, "Exactly one process must successfully claim");
    assert.equal(failures.length, 3, "Remaining processes must fail cleanly");
  } finally {
    if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(`${filePath}.lock`)) fs.unlinkSync(`${filePath}.lock`);
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
  const { claimId } = await engine.claimIssue("5", { nonce: "worker-1" });
  await engine.updateStatus("5", "in-progress", { claimId });

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
  await engine1.updateStatus("3", "in-progress", { claimId: claim1.claimId });

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

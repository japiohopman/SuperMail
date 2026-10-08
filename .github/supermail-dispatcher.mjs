import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const STATES = Object.freeze([
  "roadmap-ready",
  "claimed",
  "in-progress",
  "PR",
  "awaiting-review",
  "changes-requested",
  "approved",
  "merged"
]);

export const VALID_TRANSITIONS = Object.freeze({
  "roadmap-ready": ["claimed"],
  "claimed": ["in-progress", "roadmap-ready"],
  "in-progress": ["PR", "awaiting-review", "roadmap-ready"],
  "PR": ["awaiting-review", "changes-requested", "in-progress"],
  "awaiting-review": ["approved", "changes-requested"],
  "changes-requested": ["in-progress", "awaiting-review", "PR"],
  "approved": ["merged", "changes-requested"],
  "merged": []
});

export const STATES_REQUIRING_CLAIM = Object.freeze([
  "claimed",
  "in-progress",
  "PR",
  "awaiting-review",
  "changes-requested",
  "approved"
]);

export function isValidState(state) {
  return STATES.includes(state);
}

export function isValidTransition(fromState, toState) {
  if (fromState === toState) return true;
  const allowed = VALID_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.includes(toState));
}

export function makeClaimId(issueNumber, nonce = "local", timestamp = Date.now()) {
  const safeNonce = String(nonce || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `jules-${timestamp}-${issueNumber}-${safeNonce || "local"}`;
}

export function makeReviewKey(repository, pullRequest, headSha) {
  return `${repository}#${pullRequest}@${headSha}`;
}

/**
 * Abstract Persistence Adapter Contract for Dispatcher Engine.
 */
export class PersistenceAdapter {
  async load() {
    throw new Error("PersistenceAdapter.load() must be implemented by subclass.");
  }

  async save(state, expectedVersion = null) {
    throw new Error("PersistenceAdapter.save() must be implemented by subclass.");
  }

  async withLock(fn) {
    return fn();
  }
}

export class MemoryPersistenceAdapter extends PersistenceAdapter {
  constructor(initialState = null) {
    super();
    this.state = initialState ? JSON.parse(JSON.stringify(initialState)) : {
      version: "1.0.0",
      revision: 0,
      updatedAt: new Date().toISOString(),
      issues: {},
      sessions: {}
    };
    this._locked = false;
  }

  async withLock(fn) {
    while (this._locked) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    this._locked = true;
    try {
      return await fn();
    } finally {
      this._locked = false;
    }
  }

  async load() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async save(state, expectedVersion = null) {
    if (expectedVersion !== null && expectedVersion !== undefined) {
      if (this.state.revision !== expectedVersion) {
        throw new Error(`CAS conflict: expected version ${expectedVersion}, but current version is ${this.state.revision}`);
      }
    }
    const nextRevision = (this.state.revision || 0) + 1;
    const newState = JSON.parse(JSON.stringify(state));
    newState.revision = nextRevision;
    newState.updatedAt = new Date().toISOString();
    this.state = newState;
    return JSON.parse(JSON.stringify(this.state));
  }
}

export class FilePersistenceAdapter extends PersistenceAdapter {
  constructor(filePath, options = {}) {
    super();
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.lockTimeoutMs = options.lockTimeoutMs || 5000;
    this.lockRetryIntervalMs = options.lockRetryIntervalMs || 10;
  }

  async acquireLock() {
    const start = Date.now();
    const dir = path.dirname(this.lockPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    while (Date.now() - start < this.lockTimeoutMs) {
      try {
        const fd = fs.openSync(this.lockPath, "wx");
        fs.writeSync(fd, `${process.pid}\n`);
        fs.closeSync(fd);
        return;
      } catch (err) {
        if (err.code === "EEXIST") {
          // Check for stale lockfile (>10 seconds old)
          try {
            const stat = fs.statSync(this.lockPath);
            if (Date.now() - stat.mtimeMs > 10000) {
              fs.unlinkSync(this.lockPath);
              continue;
            }
          } catch {
            // Lockfile might have been deleted concurrently
          }
          await new Promise((resolve) => setTimeout(resolve, this.lockRetryIntervalMs));
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Failed to acquire lock file ${this.lockPath} within ${this.lockTimeoutMs}ms`);
  }

  releaseLock() {
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // Ignore if unlinking fails during cleanup
    }
  }

  async withLock(fn) {
    await this.acquireLock();
    try {
      return await fn();
    } finally {
      this.releaseLock();
    }
  }

  async load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return {
        version: "1.0.0",
        revision: 0,
        updatedAt: new Date().toISOString(),
        issues: {},
        sessions: {}
      };
    }
    const data = fs.readFileSync(this.filePath, "utf8");
    try {
      return JSON.parse(data);
    } catch (err) {
      throw new Error(`Malformed dispatcher state file at ${this.filePath}: ${err.message}`);
    }
  }

  async save(state, expectedVersion = null) {
    let currentDiskRevision = 0;
    if (fs.existsSync(this.filePath)) {
      let currentData;
      try {
        currentData = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      } catch (err) {
        throw new Error(`Malformed dispatcher state file at ${this.filePath}: ${err.message}`);
      }
      currentDiskRevision = currentData.revision || 0;
    }

    if (expectedVersion !== null && expectedVersion !== undefined) {
      if (currentDiskRevision !== expectedVersion) {
        throw new Error(`CAS conflict: expected file revision ${expectedVersion}, but current file revision is ${currentDiskRevision}`);
      }
    }

    const nextRevision = currentDiskRevision + 1;
    const newState = JSON.parse(JSON.stringify(state));
    newState.revision = nextRevision;
    newState.updatedAt = new Date().toISOString();

    const dir = path.dirname(this.filePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const uniqueTag = crypto.randomBytes(8).toString("hex");
    const tempPath = `${this.filePath}.tmp.${Date.now()}.${uniqueTag}`;
    fs.writeFileSync(tempPath, JSON.stringify(newState, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);

    return newState;
  }
}

export class DispatcherEngine {
  constructor(options = {}) {
    if (options.adapter) {
      this.adapter = options.adapter;
    } else if (options.filePath) {
      this.adapter = new FilePersistenceAdapter(options.filePath);
    } else {
      this.adapter = new MemoryPersistenceAdapter();
    }

    this.leaseDurationMs = options.leaseDurationMs || 3600000; // default 1 hour
    this.state = {
      version: "1.0.0",
      revision: 0,
      updatedAt: new Date().toISOString(),
      issues: {},
      sessions: {}
    };
  }

  async init() {
    return this.adapter.withLock(async () => {
      this.state = await this.adapter.load();
      this.normalizeInvariants();
      return this;
    });
  }

  async sync() {
    this.state = await this.adapter.load();
    this.normalizeInvariants();
    return this;
  }

  normalizeInvariants() {
    for (const issueId of Object.keys(this.state.issues)) {
      const issue = this.state.issues[issueId];
      if (issue.status === "roadmap-ready" || issue.status === "merged") {
        if (issue.claim) {
          const claimId = issue.claim.claimId;
          issue.claim = null;
          if (this.state.sessions[claimId]) {
            this.state.sessions[claimId].status = issue.status === "roadmap-ready" ? "reset" : "completed";
            this.state.sessions[claimId].updatedAt = new Date().toISOString();
          }
        }
      }
    }
  }

  async save() {
    const currentRevision = this.state.revision || 0;
    this.normalizeInvariants();
    this.state = await this.adapter.save(this.state, currentRevision);
  }

  async registerIssue(issue) {
    return this.adapter.withLock(async () => {
      await this.sync();
      const issueId = String(issue.issueId || issue.number);
      const existing = this.state.issues[issueId] || null;

      let targetStatus = issue.status || (existing ? existing.status : "roadmap-ready");
      if (!isValidState(targetStatus)) {
        throw new Error(`Invalid issue status: ${targetStatus}`);
      }

      let claim = existing ? existing.claim : null;

      // Reject registering into states requiring a claim if no active claim exists
      if (STATES_REQUIRING_CLAIM.includes(targetStatus) && !claim) {
        throw new Error(`Cannot register issue ${issueId} in status '${targetStatus}' without an active claim.`);
      }

      if (existing) {
        if (existing.status !== targetStatus && !isValidTransition(existing.status, targetStatus)) {
          throw new Error(`Cannot register issue ${issueId}: invalid state transition from ${existing.status} to ${targetStatus}`);
        }
      }

      // Invariant: "roadmap-ready" or "merged" status must NEVER retain an active claim
      if (targetStatus === "roadmap-ready" || targetStatus === "merged") {
        if (claim) {
          const claimId = claim.claimId;
          if (this.state.sessions[claimId]) {
            this.state.sessions[claimId].status = targetStatus === "roadmap-ready" ? "reset" : "completed";
            this.state.sessions[claimId].updatedAt = new Date().toISOString();
          }
          claim = null;
        }
      }

      this.state.issues[issueId] = {
        issueId,
        title: issue.title || (existing ? existing.title : ""),
        body: issue.body || (existing ? existing.body : ""),
        prerequisites: issue.prerequisites ? issue.prerequisites.map(String) : (existing ? existing.prerequisites : []),
        acceptanceCriteria: issue.acceptanceCriteria || (existing ? existing.acceptanceCriteria : []),
        likelyModules: issue.likelyModules || (existing ? existing.likelyModules : []),
        securityImpact: issue.securityImpact || (existing ? existing.securityImpact : "Development-plane only."),
        repositoryInstructions: issue.repositoryInstructions || (existing ? existing.repositoryInstructions : "See AGENTS.md and docs/DISPATCH.md"),
        validationCommands: issue.validationCommands || (existing ? existing.validationCommands : [
          "npm test",
          "npm run lint",
          "npm run typecheck",
          "npm run build"
        ]),
        status: targetStatus,
        claim
      };

      await this.save();
      return this.state.issues[issueId];
    });
  }

  getIssue(issueId) {
    return this.state.issues[String(issueId)] || null;
  }

  getAllIssues() {
    return Object.values(this.state.issues);
  }

  getSession(claimId) {
    return this.state.sessions[claimId] || null;
  }

  checkPrerequisites(issueId) {
    const issue = this.getIssue(issueId);
    if (!issue) {
      return { ok: false, reason: `Issue ${issueId} not found.` };
    }
    const unmerged = [];
    for (const prereqId of issue.prerequisites) {
      const prereq = this.getIssue(prereqId);
      if (!prereq || prereq.status !== "merged") {
        unmerged.push(prereqId);
      }
    }
    if (unmerged.length > 0) {
      return {
        ok: false,
        reason: `Prerequisite issues not merged: ${unmerged.join(", ")}`,
        unmerged
      };
    }
    return { ok: true, unmerged: [] };
  }

  recoverStaleClaims(nowMs = Date.now()) {
    const recovered = [];
    for (const issueId of Object.keys(this.state.issues)) {
      const issue = this.state.issues[issueId];
      if (issue.claim) {
        const expiresAt = new Date(issue.claim.expiresAt).getTime();
        if (nowMs > expiresAt) {
          const claimId = issue.claim.claimId;
          recovered.push({ issueId, claimId });
          issue.status = "roadmap-ready";
          issue.claim = null;
          if (this.state.sessions[claimId]) {
            this.state.sessions[claimId].status = "stale-recovered";
            this.state.sessions[claimId].updatedAt = new Date(nowMs).toISOString();
          }
        }
      }
    }
    return recovered;
  }

  async claimIssue(issueId, options = {}) {
    return this.adapter.withLock(async () => {
      await this.sync();
      const idStr = String(issueId);
      const nowMs = options.nowMs || Date.now();

      const recovered = this.recoverStaleClaims(nowMs);
      if (recovered.length > 0) {
        this.normalizeInvariants();
      }

      const issue = this.getIssue(idStr);
      if (!issue) {
        throw new Error(`Cannot claim issue ${idStr}: issue does not exist.`);
      }

      if (issue.status !== "roadmap-ready") {
        throw new Error(`Cannot claim issue ${idStr}: status is '${issue.status}', but must be exactly 'roadmap-ready'.`);
      }

      if (issue.claim) {
        throw new Error(`Cannot claim issue ${idStr}: issue has an active claim structure.`);
      }

      const prereqCheck = this.checkPrerequisites(idStr);
      if (!prereqCheck.ok) {
        throw new Error(`Cannot claim issue ${idStr}: ${prereqCheck.reason}`);
      }

      const nonce = options.nonce || crypto.randomBytes(4).toString("hex");
      const claimId = makeClaimId(idStr, nonce, nowMs);
      const leaseDuration = options.leaseDurationMs || this.leaseDurationMs;
      const expiresAt = new Date(nowMs + leaseDuration).toISOString();

      const claimData = {
        claimId,
        sessionId: options.sessionId || `session-${nonce}`,
        claimedAt: new Date(nowMs).toISOString(),
        expiresAt,
        lastHeartbeat: new Date(nowMs).toISOString()
      };

      issue.status = "claimed";
      issue.claim = claimData;

      this.state.sessions[claimId] = {
        claimId,
        issueId: idStr,
        status: "claimed",
        createdAt: claimData.claimedAt,
        updatedAt: claimData.claimedAt,
        expiresAt,
        pullRequest: null,
        headSha: null
      };

      await this.save();

      return {
        claimId,
        issue,
        session: this.state.sessions[claimId]
      };
    });
  }

  async heartbeatClaim(claimId, options = {}) {
    return this.adapter.withLock(async () => {
      await this.sync();
      const nowMs = options.nowMs || Date.now();
      const session = this.state.sessions[claimId];
      if (!session) {
        throw new Error(`Session with claimId ${claimId} not found.`);
      }

      const issue = this.getIssue(session.issueId);
      if (!issue || !issue.claim || issue.claim.claimId !== claimId) {
        throw new Error(`Active claim for claimId ${claimId} not found on issue ${session.issueId}.`);
      }

      const leaseDuration = options.leaseDurationMs || this.leaseDurationMs;
      const expiresAt = new Date(nowMs + leaseDuration).toISOString();

      issue.claim.lastHeartbeat = new Date(nowMs).toISOString();
      issue.claim.expiresAt = expiresAt;

      session.updatedAt = new Date(nowMs).toISOString();
      session.expiresAt = expiresAt;

      await this.save();
      return { issue, session };
    });
  }

  async releaseClaim(claimId, reason = "released") {
    return this.adapter.withLock(async () => {
      await this.sync();
      const session = this.state.sessions[claimId];
      if (!session) {
        throw new Error(`Session with claimId ${claimId} not found.`);
      }

      const issue = this.getIssue(session.issueId);
      if (issue) {
        issue.status = "roadmap-ready";
        issue.claim = null;
      }

      session.status = `released: ${reason}`;
      session.updatedAt = new Date().toISOString();

      await this.save();
      return { issue, session };
    });
  }

  async updateStatus(issueId, newStatus, extraData = {}) {
    return this.adapter.withLock(async () => {
      await this.sync();
      const idStr = String(issueId);
      const issue = this.getIssue(idStr);
      if (!issue) {
        throw new Error(`Issue ${idStr} not found.`);
      }

      if (!isValidState(newStatus)) {
        throw new Error(`Invalid state: ${newStatus}`);
      }

      if (!isValidTransition(issue.status, newStatus)) {
        throw new Error(`Invalid state transition from ${issue.status} to ${newStatus}`);
      }

      issue.status = newStatus;

      if (issue.claim) {
        const claimId = issue.claim.claimId;
        const session = this.state.sessions[claimId];
        if (session) {
          session.status = (newStatus === "roadmap-ready" || newStatus === "merged") ? (newStatus === "roadmap-ready" ? "reset" : "completed") : newStatus;
          session.updatedAt = new Date().toISOString();
          if (extraData.pullRequest) session.pullRequest = extraData.pullRequest;
          if (extraData.headSha) session.headSha = extraData.headSha;
        }
      }

      if (newStatus === "roadmap-ready" || newStatus === "merged") {
        issue.claim = null;
      }

      await this.save();
      return issue;
    });
  }

  generateHandoffPacket(issueId) {
    const issue = this.getIssue(issueId);
    if (!issue) {
      throw new Error(`Issue ${issueId} not found.`);
    }
    const prereqCheck = this.checkPrerequisites(issueId);
    return {
      issue: {
        issueId: issue.issueId,
        title: issue.title,
        body: issue.body,
        status: issue.status
      },
      acceptanceCriteria: issue.acceptanceCriteria,
      prerequisites: issue.prerequisites,
      dependencyStatus: prereqCheck.ok ? "satisfied" : "blocked",
      repositoryInstructions: issue.repositoryInstructions,
      validationCommands: issue.validationCommands,
      julesInstructions: `@jules Implement issue #${issue.issueId} (${issue.title}). Treat docs/DISPATCH.md and AGENTS.md as hard constraints. Keep the dispatcher separate from the SuperMail runtime agent. Add tests and documentation, and report the exact validation commands in the PR.`
    };
  }
}

if (import.meta.url === "file://" + process.argv[1]) {
  console.log(JSON.stringify({
    states: STATES,
    contract: "issue -> claim -> Jules -> PR -> AI review -> merge"
  }, null, 2));
}

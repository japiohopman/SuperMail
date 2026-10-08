import fs from "node:fs";
import path from "node:path";

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

export function isValidState(state) {
  return STATES.includes(state);
}

export function isValidTransition(fromState, toState) {
  if (fromState === toState) return true;
  const allowed = VALID_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.includes(toState));
}

export function makeClaimId(issueNumber, nonce = "local", timestamp = Date.now()) {
  return `jules-${timestamp}-${issueNumber}-${nonce}`;
}

export function makeReviewKey(repository, pullRequest, headSha) {
  return `${repository}#${pullRequest}@${headSha}`;
}

export class DispatcherEngine {
  constructor(options = {}) {
    this.filePath = options.filePath || null;
    this.leaseDurationMs = options.leaseDurationMs || 3600000; // default 1 hour
    this.state = {
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
      issues: {},
      sessions: {}
    };

    if (this.filePath) {
      this.load();
    }
  }

  load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf8");
        this.state = JSON.parse(data);
      }
    } catch (err) {
      throw new Error(`Failed to load dispatcher state from ${this.filePath}: ${err.message}`);
    }
  }

  save() {
    if (!this.filePath) return;
    this.state.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.filePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  registerIssue(issue) {
    const issueId = String(issue.issueId || issue.number);
    const existing = this.state.issues[issueId] || {};
    this.state.issues[issueId] = {
      issueId,
      title: issue.title || existing.title || "",
      body: issue.body || existing.body || "",
      prerequisites: issue.prerequisites ? issue.prerequisites.map(String) : (existing.prerequisites || []),
      acceptanceCriteria: issue.acceptanceCriteria || existing.acceptanceCriteria || [],
      likelyModules: issue.likelyModules || existing.likelyModules || [],
      securityImpact: issue.securityImpact || existing.securityImpact || "Development-plane only.",
      repositoryInstructions: issue.repositoryInstructions || existing.repositoryInstructions || "See AGENTS.md and docs/DISPATCH.md",
      validationCommands: issue.validationCommands || existing.validationCommands || [
        "npm test",
        "npm run lint",
        "npm run typecheck",
        "npm run build"
      ],
      status: issue.status || existing.status || "roadmap-ready",
      claim: existing.claim || null
    };
    this.save();
    return this.state.issues[issueId];
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
    if (recovered.length > 0) {
      this.save();
    }
    return recovered;
  }

  claimIssue(issueId, options = {}) {
    const idStr = String(issueId);
    const nowMs = options.nowMs || Date.now();

    // Recover stale claims prior to attempting claim
    this.recoverStaleClaims(nowMs);

    const issue = this.getIssue(idStr);
    if (!issue) {
      throw new Error(`Cannot claim issue ${idStr}: issue does not exist.`);
    }

    if (issue.status !== "roadmap-ready" && issue.claim) {
      throw new Error(`Cannot claim issue ${idStr}: already claimed by claimId ${issue.claim.claimId}.`);
    }

    if (issue.status === "merged") {
      throw new Error(`Cannot claim issue ${idStr}: issue is already merged.`);
    }

    const prereqCheck = this.checkPrerequisites(idStr);
    if (!prereqCheck.ok) {
      throw new Error(`Cannot claim issue ${idStr}: ${prereqCheck.reason}`);
    }

    const nonce = options.nonce || "local";
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

    this.save();

    return {
      claimId,
      issue,
      session: this.state.sessions[claimId]
    };
  }

  heartbeatClaim(claimId, options = {}) {
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

    this.save();
    return { issue, session };
  }

  releaseClaim(claimId, reason = "released") {
    const session = this.state.sessions[claimId];
    if (!session) {
      throw new Error(`Session with claimId ${claimId} not found.`);
    }

    const issue = this.getIssue(session.issueId);
    if (issue && issue.claim && issue.claim.claimId === claimId) {
      issue.status = "roadmap-ready";
      issue.claim = null;
    }

    session.status = `released: ${reason}`;
    session.updatedAt = new Date().toISOString();

    this.save();
    return { issue, session };
  }

  updateStatus(issueId, newStatus, extraData = {}) {
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
      const session = this.state.sessions[issue.claim.claimId];
      if (session) {
        session.status = newStatus;
        session.updatedAt = new Date().toISOString();
        if (extraData.pullRequest) session.pullRequest = extraData.pullRequest;
        if (extraData.headSha) session.headSha = extraData.headSha;
      }
    }

    if (newStatus === "merged") {
      issue.claim = null;
    }

    this.save();
    return issue;
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

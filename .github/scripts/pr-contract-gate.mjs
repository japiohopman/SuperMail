import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SECTIONS = [
  "## Change",
  "## Status and handoff",
  "## Acceptance criteria",
  "## Verification",
  "## Blocker / dead-end report",
  "## Latest reviewer instruction",
  "## Safety",
];

const REQUIRED_COMMANDS = ["npm test", "npm run lint", "npm run typecheck", "npm run build"];

function getSection(body, heading) {
  const start = body.indexOf(heading);
  if (start < 0) return "";
  const contentStart = start + heading.length;
  const nextHeading = body.slice(contentStart).search(/^##\s/m);
  return body.slice(contentStart, nextHeading < 0 ? undefined : contentStart + nextHeading).trim();
}

function getField(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp("^\\s*-\\s*\\*\\*" + escaped + ":\\*\\*\\s*(.+)$", "im"));
  return match?.[1]?.trim() ?? "";
}

function isPlaceholder(value) {
  return !value || /^<!--.*-->$/.test(value) || /^(?:todo|tbd|fill me|replace me)$/i.test(value);
}

export function validatePrContract(input) {
  const body = String(input.body ?? "");
  const errors = [];

  if (input.draft) {
    return { ok: true, skipped: true, status: "DRAFT", errors: [] };
  }

  for (const heading of REQUIRED_SECTIONS) {
    if (!body.includes(heading)) errors.push(`Missing required section: ${heading}`);
  }

  const statusField = getField(body, "Status");
  const statusMatch = statusField.match(/^\x60?(IN PROGRESS|BLOCKED|READY FOR REVIEW)\x60?\s*$/i);
  const status = statusMatch?.[1]?.toUpperCase() ?? "";
  if (!status) {
    errors.push("Status must be exactly IN PROGRESS, BLOCKED, or READY FOR REVIEW.");
  } else if (status !== "READY FOR REVIEW") {
    errors.push("A non-draft PR must report READY FOR REVIEW. Keep blocked/in-progress work in Draft.");
  }

  const shaField = getField(body, "Current head SHA").replace(/`/g, "").trim();
  if (!/^[a-f0-9]{40}$/i.test(shaField)) {
    errors.push("Current head SHA must contain the exact 40-character commit SHA.");
  } else if (shaField.toLowerCase() !== String(input.headSha ?? "").toLowerCase()) {
    errors.push(`PR body head SHA is stale. Body: ${shaField}; event head: ${input.headSha ?? "(missing)"}.`);
  }

  const changedFilesField = getField(body, "Changed files");
  if (isPlaceholder(changedFilesField)) {
    errors.push("Changed files must list the actual paths and explain the substantive changes.");
  }
  const handoff = getSection(body, "## Status and handoff");
  const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles : [];
  if (changedFiles.length === 0) errors.push("GitHub reports no changed files for this PR.");
  for (const path of changedFiles) {
    if (!handoff.includes(path)) errors.push(`Changed files list is missing path: ${path}`);
  }

  const remaining = getField(body, "Remaining blockers/risks");
  if (isPlaceholder(remaining)) errors.push("Remaining blockers/risks must state known risks or explicitly say none.");
  const nextAction = getField(body, "Next action / owner");
  if (isPlaceholder(nextAction)) errors.push("Next action / owner must identify the concrete next step and owner.");

  const acceptance = getSection(body, "## Acceptance criteria");
  const criterionChecks = [...acceptance.matchAll(/^-\s*\[([ xX])\]\s+.+$/gm)];
  if (criterionChecks.length === 0) {
    errors.push("Acceptance criteria must contain one or more explicit Markdown checklist items.");
  } else if (criterionChecks.some((match) => match[1].toLowerCase() !== "x")) {
    errors.push("All acceptance criteria must be checked before a PR can be marked READY FOR REVIEW.");
  }

  const verification = getSection(body, "## Verification");
  const verifiedCiRunIds = new Set((input.verifiedCiRunIds ?? []).map(String));
  for (const command of REQUIRED_COMMANDS) {
    const commandLine = verification.split("\n").find((line) => line.includes(command));
    if (!commandLine || !/\b(pass(?:ed)?|success(?:ful)?)\b/i.test(commandLine)) {
      errors.push(`Verification must report ${command} as passed on the current head.`);
      continue;
    }
    if (!commandLine.includes(String(input.headSha ?? ""))) {
      errors.push(`Verification line for ${command} must include the exact current head SHA.`);
    }
    const citedRunId = commandLine.match(/actions\/runs\/(\d+)/)?.[1];
    if (!citedRunId || !verifiedCiRunIds.has(citedRunId)) {
      errors.push(`Verification line for ${command} must link to a successful CI run on the current head SHA.`);
    }
  }
  if (!/https:\/\/github\.com\/[^\s)]+\/actions\/runs\/\d+/i.test(verification)) {
    errors.push("Verification must link to the GitHub Actions run for the reported head.");
  }
  if (/-\s*\[\s\]\s+/.test(verification)) {
    errors.push("All required verification and safety checklist items must be checked before review.");
  }

  const blockers = getSection(body, "## Blocker / dead-end report");
  if (!/\b(none|no blockers|no known blockers|not blocked)\b/i.test(blockers)) {
    const requiredBlockerFields = ["Attempted", "Observed evidence", "Acceptance criteria affected", "Alternatives considered", "Decision or help needed", "Safest next step"];
    for (const field of requiredBlockerFields) {
      if (!new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(blockers)) {
        errors.push(`Blocker / dead-end report must say none, or include: ${field}.`);
      }
    }
  }

  const reviewerInstruction = getSection(body, "## Latest reviewer instruction");
  for (const field of ["Required changes", "Verification required", "Do not change", "Completion signal"]) {
    if (!new RegExp(`\\b${field}\\b`, "i").test(reviewerInstruction)) {
      errors.push(`Latest reviewer instruction must include the field: ${field}.`);
    }
  }

  const safety = getSection(body, "## Safety");
  if (isPlaceholder(safety) || safety.replace(/<!--.*?-->/gs, "").trim().length < 12) {
    errors.push("Safety must state the security/privacy impact and confirm whether sensitive data or permissions changed.");
  }

  if (input.noOpInspectionFailed === true) {
    errors.push("Unable to verify whether the latest commit changes the repository tree.");
  }
  if (input.lastCommitTreeIdenticalToParent === true) {
    errors.push("The latest commit has the same tree as its parent (no-op commit). Do not present it as implementation progress.");
  }

  return { ok: errors.length === 0, skipped: false, status: status || "INVALID", errors };
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node .github/scripts/pr-contract-gate.mjs <input.json>");
    process.exitCode = 2;
    return;
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch (error) {
    console.error(`Unable to read pull request contract input: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const result = validatePrContract(input);
  if (result.skipped) {
    console.log("PR contract gate skipped: draft PRs are allowed to remain incomplete.");
    return;
  }

  if (result.ok) {
    console.log(`PR contract gate passed for status ${result.status} and head SHA ${input.headSha}.`);
    return;
  }

  console.error("PR contract gate failed:");
  for (const error of result.errors) console.error(`- ${error}`);
  console.error("\nUpdate the PR body to match the current head, verify every acceptance criterion, and report exact check results before requesting review.");
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

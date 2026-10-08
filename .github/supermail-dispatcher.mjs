const STATES = Object.freeze([
  "roadmap-ready",
  "claimed",
  "in-progress",
  "awaiting-review",
  "changes-requested",
  "approved",
  "merged"
]);

export function isValidState(state) {
  return STATES.includes(state);
}

export function makeClaimId(issueNumber, nonce = "local") {
  return "jules-" + Date.now() + "-" + issueNumber + "-" + nonce;
}

export function makeReviewKey(repository, pullRequest, headSha) {
  return repository + "#" + pullRequest + "@" + headSha;
}

if (import.meta.url === "file://" + process.argv[1]) {
  console.log(JSON.stringify({
    states: STATES,
    contract: "issue -> claim -> Jules -> PR -> AI review -> merge"
  }, null, 2));
}

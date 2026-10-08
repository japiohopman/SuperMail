export const PROJECT_NAME = "SuperMail";

export { TokenStore } from "./auth/token-store.mjs";
export { GmailOAuthClient, GMAIL_SCOPES, DEFAULT_SCOPES, sanitizeLogOutput } from "./auth/gmail-oauth.mjs";
export { GmailAdapter } from "./adapters/gmail-adapter.mjs";

export function health() {
  return { project: PROJECT_NAME, stage: "foundation", mailboxAccess: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(health()));
}

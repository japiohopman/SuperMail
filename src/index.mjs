export const PROJECT_NAME = "SuperMail";

export function health() {
  return { project: PROJECT_NAME, stage: "foundation", mailboxAccess: false };
}

export { Message } from "./domain/message.mjs";
export { MailboxStore } from "./domain/store.mjs";
export { SyncEngine } from "./sync/engine.mjs";
export { MockGmailProvider } from "./provider/mockProvider.mjs";
export { ProviderError, StaleHistoryError } from "./provider/errors.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(health()));
}

export const PROJECT_NAME = "SuperMail";

export function health() {
  return { project: PROJECT_NAME, stage: "foundation", mailboxAccess: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(health()));
}

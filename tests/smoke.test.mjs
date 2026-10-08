import test from "node:test";
import assert from "node:assert/strict";
import { health } from "../src/index.mjs";

test("foundation health state is explicit", () => {
  assert.deepEqual(health(), { project: "SuperMail", stage: "foundation", mailboxAccess: false });
});

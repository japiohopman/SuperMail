import test from "node:test";
import assert from "node:assert/strict";
import { MailboxStore } from "../src/domain/store.mjs";
import { SyncEngine } from "../src/sync/engine.mjs";
import { MockGmailProvider } from "../src/provider/mockProvider.mjs";

function createSampleMsg(id, historyId = "100", labelIds = ["INBOX"]) {
  return {
    id,
    threadId: `thread_${id}`,
    historyId,
    labelIds,
    snippet: `Snippet for ${id}`,
    internalDate: "1700000000000",
    payload: {
      headers: [
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "recipient@example.com" },
        { name: "Subject", value: `Subject ${id}` },
      ],
      mimeType: "text/plain",
      body: {
        data: Buffer.from(`Body content ${id}`).toString("base64url"),
      },
    },
  };
}

test("SyncEngine perform cold start full reconciliation", async () => {
  const msg1 = createSampleMsg("msg_1", "100");
  const msg2 = createSampleMsg("msg_2", "101");

  const provider = new MockGmailProvider({
    emailAddress: "test@example.com",
    historyId: "105",
    messages: [msg1, msg2],
  });

  const store = new MailboxStore();
  const engine = new SyncEngine({ provider, store });

  const result = await engine.sync();

  assert.equal(result.type, "full");
  assert.equal(result.messagesSynced, 2);
  assert.equal(result.recovered, false);
  assert.equal(store.getHistoryId(), "105");
  assert.equal(store.getAllMessages().length, 2);
});

test("SyncEngine performs incremental sync for creates, updates, label changes, deletes", async () => {
  const msg1 = createSampleMsg("msg_1", "100", ["INBOX"]);
  const provider = new MockGmailProvider({
    historyId: "100",
    minHistoryId: "100",
    messages: [msg1],
  });

  const store = new MailboxStore();
  const engine = new SyncEngine({ provider, store });

  // Cold start sync
  await engine.sync();
  assert.equal(store.getAllMessages().length, 1);
  assert.equal(store.getHistoryId(), "100");

  // 1. Simulate new message creation
  const msg2 = createSampleMsg("msg_2", "101", ["INBOX"]);
  provider.addMessage(msg2, "101");

  let syncResult = await engine.sync();
  assert.equal(syncResult.type, "incremental");
  assert.equal(store.getAllMessages().length, 2);
  assert.equal(store.getHistoryId(), "101");

  // 2. Simulate label addition and removal
  provider.modifyLabels("msg_1", ["STARRED"], ["INBOX"], "102");
  syncResult = await engine.sync();
  assert.equal(syncResult.type, "incremental");
  assert.equal(store.getHistoryId(), "102");
  const updatedMsg1 = store.getMessage("msg_1");
  assert.deepEqual(updatedMsg1.labelIds, ["STARRED"]);

  // 3. Simulate message deletion
  provider.deleteMessage("msg_2", "103");
  syncResult = await engine.sync();
  assert.equal(syncResult.type, "incremental");
  assert.equal(store.getHistoryId(), "103");
  assert.equal(store.getMessage("msg_2"), null);
  assert.equal(store.getAllMessages().length, 1);
});

test("SyncEngine handles history gap / stale history by performing full reconciliation recovery", async () => {
  const msg1 = createSampleMsg("msg_1", "100");
  const provider = new MockGmailProvider({
    historyId: "100",
    minHistoryId: "100",
    messages: [msg1],
  });

  const store = new MailboxStore();
  const engine = new SyncEngine({ provider, store });

  await engine.sync();
  assert.equal(store.getHistoryId(), "100");

  // Simulate missed notifications and provider history expiration
  const msg2 = createSampleMsg("msg_2", "500");
  provider.addMessage(msg2, "500");
  provider.expireHistoryBefore("400"); // History record for 100 is now gone!

  const result = await engine.sync();

  assert.equal(result.type, "full");
  assert.equal(result.recovered, true);
  assert.equal(result.reason, "stale_history");
  assert.equal(store.getHistoryId(), "500");
  assert.equal(store.getAllMessages().length, 2);
});

test("SyncEngine operations are safe and idempotent on replay", async () => {
  const msg1 = createSampleMsg("msg_1", "100", ["INBOX"]);
  const provider = new MockGmailProvider({
    historyId: "100",
    minHistoryId: "100",
    messages: [msg1],
  });

  const store = new MailboxStore();
  const engine = new SyncEngine({ provider, store });

  await engine.sync();

  const msg2 = createSampleMsg("msg_2", "101", ["INBOX"]);
  provider.addMessage(msg2, "101");

  // Sync once
  await engine.sync();
  const countFirst = store.getAllMessages().length;
  const historyFirst = store.getHistoryId();

  // Re-run sync with same provider state (replay)
  await engine.sync();
  const countSecond = store.getAllMessages().length;
  const historySecond = store.getHistoryId();

  assert.equal(countFirst, countSecond);
  assert.equal(historyFirst, historySecond);

  // Manual reconciliation replay
  await engine.reconcile();
  assert.equal(store.getAllMessages().length, 2);
  assert.equal(store.getHistoryId(), "101");
});

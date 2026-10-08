import test from "node:test";
import assert from "node:assert/strict";
import { Message } from "../src/domain/message.mjs";

test("Message.fromGmailPayload parses Gmail payload into clean domain object", () => {
  const rawMsg = {
    id: "msg_123",
    threadId: "thread_456",
    historyId: "2005",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hello World Snippet",
    internalDate: "1700000000000",
    payload: {
      headers: [
        { name: "From", value: "Alice <alice@example.com>" },
        { name: "To", value: "Bob <bob@example.com>, Carol <carol@example.com>" },
        { name: "Subject", value: "Test Email Subject" },
        { name: "Message-ID", value: "<msg123@example.com>" },
        { name: "Date", value: "Thu, 15 Nov 2023 12:00:00 GMT" },
      ],
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/plain",
          body: {
            // "Hello Plain Text" in base64url
            data: "SGVsbG8gUGxhaW4gVGV4dA==",
          },
        },
        {
          mimeType: "text/html",
          body: {
            // "<p>Hello HTML Text</p>" in base64url
            data: "PHA+SGVsbG8gSFRNTCBUZXh0PC9wPg==",
          },
        },
      ],
    },
  };

  const domainMsg = Message.fromGmailPayload(rawMsg);

  assert.equal(domainMsg.id, "msg_123");
  assert.equal(domainMsg.threadId, "thread_456");
  assert.equal(domainMsg.historyId, "2005");
  assert.deepEqual(domainMsg.labelIds, ["INBOX", "UNREAD"]);
  assert.equal(domainMsg.snippet, "Hello World Snippet");
  assert.equal(domainMsg.internalDate, 1700000000000);
  assert.equal(domainMsg.from, "Alice <alice@example.com>");
  assert.deepEqual(domainMsg.to, ["Bob <bob@example.com>", "Carol <carol@example.com>"]);
  assert.equal(domainMsg.subject, "Test Email Subject");
  assert.equal(domainMsg.messageIdHeader, "<msg123@example.com>");
  assert.equal(domainMsg.textContent, "Hello Plain Text");
  assert.equal(domainMsg.htmlContent, "<p>Hello HTML Text</p>");

  // Ensure no raw provider structures are leaked on the domain object
  assert.equal(Object.isFrozen(domainMsg), true);
  assert.equal(domainMsg.payload, undefined);
  assert.equal(domainMsg.raw, undefined);
  assert.equal(domainMsg.headers, undefined);
});

test("Message.fromGmailPayload throws TypeError on invalid payload", () => {
  assert.throws(() => Message.fromGmailPayload(null), TypeError);
  assert.throws(() => Message.fromGmailPayload(undefined), TypeError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { TokenStore } from "../../src/auth/token-store.mjs";

test("TokenStore saves and retrieves tokens", async () => {
  const store = new TokenStore();
  assert.equal(await store.getTokens(), null);

  const sampleTokens = {
    access_token: "secret_access_token_123",
    refresh_token: "secret_refresh_token_456",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "https://www.googleapis.com/auth/gmail.readonly"
  };

  await store.saveTokens(sampleTokens);
  const loaded = await store.getTokens();

  assert.equal(loaded.access_token, "secret_access_token_123");
  assert.equal(loaded.refresh_token, "secret_refresh_token_456");

  // Verify partial update preserves refresh token if not provided
  await store.saveTokens({ access_token: "new_access_token_789" });
  const updated = await store.getTokens();
  assert.equal(updated.access_token, "new_access_token_789");
  assert.equal(updated.refresh_token, "secret_refresh_token_456");

  await store.clearTokens();
  assert.equal(await store.getTokens(), null);
});

test("TokenStore redacts tokens in toString and toJSON", async () => {
  const store = new TokenStore({
    initialTokens: {
      access_token: "secret_access_token_123",
      refresh_token: "secret_refresh_token_456",
      scope: "https://www.googleapis.com/auth/gmail.readonly"
    }
  });

  const str = store.toString();
  assert.ok(!str.includes("secret_access_token_123"));
  assert.ok(!str.includes("secret_refresh_token_456"));
  assert.equal(str, "[TokenStore: REDACTED]");

  const jsonStr = JSON.stringify(store);
  assert.ok(!jsonStr.includes("secret_access_token_123"));
  assert.ok(!jsonStr.includes("secret_refresh_token_456"));

  const json = JSON.parse(jsonStr);
  assert.equal(json.hasTokens, true);
  assert.equal(json.hasRefreshToken, true);
  assert.equal(json.scopes, "https://www.googleapis.com/auth/gmail.readonly");
});

import test from "node:test";
import assert from "node:assert/strict";
import { GmailOAuthClient, GMAIL_SCOPES, sanitizeLogOutput } from "../../src/auth/gmail-oauth.mjs";
import { GmailAdapter } from "../../src/adapters/gmail-adapter.mjs";
import { TokenStore } from "../../src/auth/token-store.mjs";

test("GmailOAuthClient requires mandatory credentials", () => {
  const client = new GmailOAuthClient({ clientId: "", clientSecret: "", redirectUri: "" });
  assert.throws(() => client.getAuthorizationUrl(), /Missing OAuth credential: clientId/);
});

test("GmailOAuthClient constructs authorization URL with least privilege read scope", () => {
  const client = new GmailOAuthClient({
    clientId: "test_client_id",
    clientSecret: "test_client_secret",
    redirectUri: "http://localhost:3000/oauth/callback"
  });

  const urlStr = client.getAuthorizationUrl({ state: "xyz123" });
  const url = new URL(urlStr);

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "test_client_id");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/oauth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), GMAIL_SCOPES.READONLY);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "xyz123");
});

test("GmailOAuthClient rejects unapproved non-readonly scopes", () => {
  const client = new GmailOAuthClient({
    clientId: "test_client_id",
    clientSecret: "test_client_secret",
    redirectUri: "http://localhost:3000/oauth/callback"
  });

  assert.throws(
    () => client.getAuthorizationUrl({ scopes: ["https://www.googleapis.com/auth/gmail.send"] }),
    /not approved/
  );
});

test("GmailOAuthClient exchanges authorization code for tokens using mock fetch", async () => {
  const tokenStore = new TokenStore();
  let requestedUrl = null;
  let requestedBody = null;

  const mockFetch = async (url, options) => {
    requestedUrl = url;
    requestedBody = options.body;
    return {
      ok: true,
      json: async () => ({
        access_token: "mock_access_token_100",
        refresh_token: "mock_refresh_token_200",
        token_type: "Bearer",
        expires_in: 3600,
        scope: GMAIL_SCOPES.READONLY
      })
    };
  };

  const client = new GmailOAuthClient({
    clientId: "test_client_id",
    clientSecret: "test_client_secret",
    redirectUri: "http://localhost:3000/oauth/callback",
    tokenStore,
    fetchFn: mockFetch
  });

  const tokens = await client.exchangeCodeForTokens("auth_code_999");

  assert.equal(requestedUrl, "https://oauth2.googleapis.com/token");
  assert.ok(requestedBody.includes("grant_type=authorization_code"));
  assert.ok(requestedBody.includes("code=auth_code_999"));

  assert.equal(tokens.access_token, "mock_access_token_100");
  assert.equal(tokens.refresh_token, "mock_refresh_token_200");

  const stored = await tokenStore.getTokens();
  assert.equal(stored.access_token, "mock_access_token_100");
  assert.equal(stored.refresh_token, "mock_refresh_token_200");
});

test("GmailOAuthClient refreshes access token", async () => {
  const tokenStore = new TokenStore({
    initialTokens: {
      refresh_token: "mock_refresh_token_200"
    }
  });

  const mockFetch = async (url, options) => {
    assert.ok(options.body.includes("grant_type=refresh_token"));
    assert.ok(options.body.includes("refresh_token=mock_refresh_token_200"));
    return {
      ok: true,
      json: async () => ({
        access_token: "new_mock_access_token_300",
        token_type: "Bearer",
        expires_in: 3600,
        scope: GMAIL_SCOPES.READONLY
      })
    };
  };

  const client = new GmailOAuthClient({
    clientId: "test_client_id",
    clientSecret: "test_client_secret",
    redirectUri: "http://localhost:3000/oauth/callback",
    tokenStore,
    fetchFn: mockFetch
  });

  const refreshed = await client.refreshAccessToken();
  assert.equal(refreshed.access_token, "new_mock_access_token_300");

  const stored = await tokenStore.getTokens();
  assert.equal(stored.access_token, "new_mock_access_token_300");
  assert.equal(stored.refresh_token, "mock_refresh_token_200");
});

test("sanitizeLogOutput redacts secrets and OAuth parameters", () => {
  const rawLog = "Error at https://oauth2.googleapis.com/token?code=secret_code_123&access_token=secret_at_456&client_secret=secret_cs_789";
  const cleanLog = sanitizeLogOutput(rawLog);

  assert.ok(!cleanLog.includes("secret_code_123"));
  assert.ok(!cleanLog.includes("secret_at_456"));
  assert.ok(!cleanLog.includes("secret_cs_789"));
  assert.ok(cleanLog.includes("code=[REDACTED]"));
});

test("GmailAdapter orchestrates authentication flow and token validity check", async () => {
  const tokenStore = new TokenStore();

  const mockFetch = async () => {
    return {
      ok: true,
      json: async () => ({
        access_token: "initial_access_token",
        refresh_token: "initial_refresh_token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: GMAIL_SCOPES.READONLY
      })
    };
  };

  const oauthClient = new GmailOAuthClient({
    clientId: "test_client_id",
    clientSecret: "test_client_secret",
    redirectUri: "http://localhost:3000/oauth/callback",
    tokenStore,
    fetchFn: mockFetch
  });

  const adapter = new GmailAdapter({ tokenStore, oauthClient });

  // Get Auth URL
  const authUrl = adapter.getAuthUrl({ state: "session123" });
  assert.ok(authUrl.includes("state=session123"));

  // Handle Callback
  await adapter.handleOAuthCallback("code_from_callback");

  // Get Valid Access Token (not expired)
  const validToken = await adapter.getValidAccessToken();
  assert.equal(validToken, "initial_access_token");
});

export const GMAIL_SCOPES = Object.freeze({
  READONLY: "https://www.googleapis.com/auth/gmail.readonly"
});

export const DEFAULT_SCOPES = Object.freeze([GMAIL_SCOPES.READONLY]);

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Helper to redact sensitive values in strings or errors.
 * @param {string} text
 * @param {Array<string>} [tokensToRedact]
 * @returns {string}
 */
export function sanitizeLogOutput(text, tokensToRedact = []) {
  if (typeof text !== "string") return text;
  let clean = text;
  for (const token of tokensToRedact) {
    if (token && typeof token === "string" && token.length > 0) {
      clean = clean.split(token).join("[REDACTED]");
    }
  }
  // Generic pattern redaction for common query params or json fields
  clean = clean.replace(/(code|access_token|refresh_token|client_secret)=[^&"'\s]+/gi, "$1=[REDACTED]");
  clean = clean.replace(/"(code|access_token|refresh_token|client_secret)"\s*:\s*"[^"]+"/gi, '"$1": "[REDACTED]"');
  return clean;
}

export class GmailOAuthClient {
  /**
   * @param {Object} config
   * @param {string} [config.clientId]
   * @param {string} [config.clientSecret]
   * @param {string} [config.redirectUri]
   * @param {TokenStore} [config.tokenStore]
   * @param {typeof fetch} [config.fetchFn]
   */
  constructor(config = {}) {
    this.clientId = config.clientId || process.env.GMAIL_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.GMAIL_CLIENT_SECRET;
    this.redirectUri = config.redirectUri || process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/oauth/callback";
    this.tokenStore = config.tokenStore || null;
    this.fetchFn = config.fetchFn || globalThis.fetch;
  }

  /**
   * Validate required environment/client credentials.
   */
  validateCredentials() {
    if (!this.clientId) {
      throw new Error("Missing OAuth credential: clientId (GMAIL_CLIENT_ID)");
    }
    if (!this.clientSecret) {
      throw new Error("Missing OAuth credential: clientSecret (GMAIL_CLIENT_SECRET)");
    }
    if (!this.redirectUri) {
      throw new Error("Missing OAuth credential: redirectUri (GMAIL_REDIRECT_URI)");
    }
  }

  /**
   * Generates explicit authorization URL for Google OAuth flow.
   * @param {Object} [options]
   * @param {Array<string>} [options.scopes]
   * @param {string} [options.state]
   * @param {string} [options.prompt]
   * @param {string} [options.accessType]
   * @returns {string}
   */
  getAuthorizationUrl(options = {}) {
    this.validateCredentials();

    const scopes = options.scopes || DEFAULT_SCOPES;

    // Ensure no unapproved write scopes are passed implicitly
    for (const scope of scopes) {
      if (scope !== GMAIL_SCOPES.READONLY) {
        throw new Error(`Scope '${scope}' is not approved for initial OAuth foundation.`);
      }
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: options.accessType || "offline",
      prompt: options.prompt || "consent"
    });

    if (options.state) {
      params.append("state", options.state);
    }

    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for OAuth tokens.
   * @param {string} code
   * @returns {Promise<Object>}
   */
  async exchangeCodeForTokens(code) {
    this.validateCredentials();
    if (!code) {
      throw new Error("Authorization code is required");
    }

    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: "authorization_code"
    });

    let res;
    try {
      res = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
    } catch (err) {
      throw new Error(`Token exchange failed: ${sanitizeLogOutput(err.message)}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Token exchange failed (${res.status}): ${sanitizeLogOutput(errText)}`);
    }

    const data = await res.json();
    const tokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      scope: data.scope
    };

    if (this.tokenStore) {
      await this.tokenStore.saveTokens(tokenData);
    }

    return tokenData;
  }

  /**
   * Refresh access token using stored or provided refresh token.
   * @param {string} [refreshToken]
   * @returns {Promise<Object>}
   */
  async refreshAccessToken(refreshToken) {
    this.validateCredentials();

    let tokenToUse = refreshToken;
    if (!tokenToUse && this.tokenStore) {
      const saved = await this.tokenStore.getTokens();
      tokenToUse = saved?.refresh_token;
    }

    if (!tokenToUse) {
      throw new Error("No refresh token available");
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: tokenToUse,
      grant_type: "refresh_token"
    });

    let res;
    try {
      res = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
    } catch (err) {
      throw new Error(`Token refresh failed: ${sanitizeLogOutput(err.message)}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Token refresh failed (${res.status}): ${sanitizeLogOutput(errText)}`);
    }

    const data = await res.json();
    const tokenData = {
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      scope: data.scope,
      refresh_token: data.refresh_token || tokenToUse
    };

    if (this.tokenStore) {
      await this.tokenStore.saveTokens(tokenData);
    }

    return tokenData;
  }
}

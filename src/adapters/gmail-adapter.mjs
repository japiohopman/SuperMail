import { GmailOAuthClient } from "../auth/gmail-oauth.mjs";
import { TokenStore } from "../auth/token-store.mjs";

/**
 * Adapter interface separating Gmail provider-specific logic behind a clean domain boundary.
 */
export class GmailAdapter {
  /**
   * @param {Object} [options]
   * @param {GmailOAuthClient} [options.oauthClient]
   * @param {TokenStore} [options.tokenStore]
   */
  constructor(options = {}) {
    this.tokenStore = options.tokenStore || new TokenStore();
    this.oauthClient = options.oauthClient || new GmailOAuthClient({ tokenStore: this.tokenStore });
    this._pendingStates = new Set();
  }

  /**
   * Get authentication URL for initiating user OAuth flow and store issued state for verification.
   * @param {Object} [options]
   * @returns {{ url: string, state: string }}
   */
  getAuthUrl(options) {
    const res = this.oauthClient.getAuthorizationUrl(options);
    this._pendingStates.add(res.state);
    return res;
  }

  /**
   * Handle OAuth callback authorization code with mandatory CSRF state verification.
   * @param {string} code
   * @param {string} state
   * @returns {Promise<void>}
   */
  async handleOAuthCallback(code, state) {
    if (!state) {
      throw new Error("CSRF security verification failed: state parameter is required in callback");
    }

    if (!this._pendingStates.has(state)) {
      throw new Error("CSRF security verification failed: invalid or expired state parameter");
    }

    // One-time consumption of state
    this._pendingStates.delete(state);

    await this.oauthClient.exchangeCodeForTokens(code, { state, expectedState: state });
  }

  /**
   * Ensure active access token, refreshing if necessary.
   * @returns {Promise<string>} Valid access token
   */
  async getValidAccessToken() {
    const tokens = await this.tokenStore.getTokens();
    if (!tokens) {
      throw new Error("No OAuth tokens stored; authentication required.");
    }

    // Refresh if token is expired or expires within 60 seconds
    const isExpired = tokens.expiry_date && (Date.now() + 60000 >= tokens.expiry_date);
    if (isExpired || !tokens.access_token) {
      const newTokens = await this.oauthClient.refreshAccessToken(tokens.refresh_token);
      return newTokens.access_token;
    }

    return tokens.access_token;
  }
}

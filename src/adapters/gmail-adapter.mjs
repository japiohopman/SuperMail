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
  }

  /**
   * Get authentication URL for initiating user OAuth flow.
   * @param {Object} [options]
   * @returns {string}
   */
  getAuthUrl(options) {
    return this.oauthClient.getAuthorizationUrl(options);
  }

  /**
   * Handle OAuth callback authorization code.
   * @param {string} code
   * @returns {Promise<void>}
   */
  async handleOAuthCallback(code) {
    await this.oauthClient.exchangeCodeForTokens(code);
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

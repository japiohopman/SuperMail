/**
 * TokenStore abstraction for managing OAuth tokens securely.
 * Ensure tokens are never leaked in logs, string representations, or standard serializations.
 */

export class TokenStore {
  /**
   * @param {Object} [options]
   * @param {Object} [options.initialTokens]
   */
  constructor(options = {}) {
    this._tokens = options.initialTokens ? { ...options.initialTokens } : null;
  }

  /**
   * Save token payload.
   * Expected format: { access_token, refresh_token, token_type, expires_in, expiry_date, scope }
   * @param {Object} tokens
   */
  async saveTokens(tokens) {
    if (!tokens || typeof tokens !== "object") {
      throw new Error("Invalid tokens provided");
    }
    // Update existing tokens or overwrite
    const updated = {
      ...(this._tokens || {}),
      ...tokens
    };
    // Ensure refresh_token isn't wiped if partial token refresh occurs without new refresh_token
    if (!tokens.refresh_token && this._tokens?.refresh_token) {
      updated.refresh_token = this._tokens.refresh_token;
    }
    this._tokens = updated;
  }

  /**
   * Retrieve saved token payload or null if non-existent.
   * @returns {Promise<Object|null>}
   */
  async getTokens() {
    if (!this._tokens) {
      return null;
    }
    return { ...this._tokens };
  }

  /**
   * Clear saved tokens.
   */
  async clearTokens() {
    this._tokens = null;
  }

  /**
   * Safe toString representation preventing accidental leakage in logs.
   */
  toString() {
    return "[TokenStore: REDACTED]";
  }

  /**
   * Safe JSON representation preventing accidental JSON stringify leaks.
   */
  toJSON() {
    return {
      hasTokens: Boolean(this._tokens),
      hasRefreshToken: Boolean(this._tokens?.refresh_token),
      expiryDate: this._tokens?.expiry_date || null,
      scopes: this._tokens?.scope || null
    };
  }
}

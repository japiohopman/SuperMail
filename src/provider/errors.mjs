export class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export class StaleHistoryError extends ProviderError {
  constructor(message = "History cursor is stale or invalid", options = {}) {
    super(message, options);
    this.name = "StaleHistoryError";
    this.historyId = options.historyId ?? null;
  }
}

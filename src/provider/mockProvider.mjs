import { StaleHistoryError } from "./errors.mjs";

/**
 * In-memory Mock Gmail Provider for testing sync and reconciliation behavior.
 */
export class MockGmailProvider {
  constructor(initialData = {}) {
    this.emailAddress = initialData.emailAddress || "user@example.com";
    this.historyId = initialData.historyId ? String(initialData.historyId) : "1000";
    // Map of messageId -> raw Gmail message object
    this.messages = new Map();
    // List of history records
    this.historyRecords = [];
    // Lowest valid historyId supported by this provider instance
    this.minHistoryId = initialData.minHistoryId ? String(initialData.minHistoryId) : "1000";

    if (Array.isArray(initialData.messages)) {
      for (const msg of initialData.messages) {
        this.messages.set(msg.id, JSON.parse(JSON.stringify(msg)));
      }
    }
    if (Array.isArray(initialData.history)) {
      this.historyRecords = JSON.parse(JSON.stringify(initialData.history));
    }
  }

  async getProfile() {
    return {
      emailAddress: this.emailAddress,
      historyId: this.historyId,
    };
  }

  async listAllMessages() {
    return Array.from(this.messages.values()).map((msg) => ({
      id: msg.id,
      threadId: msg.threadId,
    }));
  }

  async getMessage(id) {
    const msg = this.messages.get(id);
    if (!msg) return null;
    return JSON.parse(JSON.stringify(msg));
  }

  async listHistory({ startHistoryId }) {
    const startStr = String(startHistoryId);
    if (BigInt(startStr) < BigInt(this.minHistoryId)) {
      throw new StaleHistoryError(`History ID ${startStr} is below minimum ${this.minHistoryId}`, {
        historyId: startStr,
      });
    }

    // Filter history records with historyId >= startHistoryId
    const matching = this.historyRecords.filter(
      (h) => h.id && BigInt(h.id) >= BigInt(startStr)
    );

    return {
      history: JSON.parse(JSON.stringify(matching)),
      historyId: this.historyId,
    };
  }

  /**
   * Helper method for tests to simulate new incoming messages on provider.
   */
  addMessage(rawMsg, newHistoryId) {
    this.messages.set(rawMsg.id, JSON.parse(JSON.stringify(rawMsg)));
    if (newHistoryId) {
      this.historyId = String(newHistoryId);
      this.historyRecords.push({
        id: String(newHistoryId),
        messagesAdded: [{ message: { id: rawMsg.id, threadId: rawMsg.threadId } }],
      });
    }
  }

  /**
   * Helper method for tests to simulate deletion on provider.
   */
  deleteMessage(id, newHistoryId) {
    this.messages.delete(id);
    if (newHistoryId) {
      this.historyId = String(newHistoryId);
      this.historyRecords.push({
        id: String(newHistoryId),
        messagesDeleted: [{ message: { id } }],
      });
    }
  }

  /**
   * Helper method for tests to simulate label changes on provider.
   */
  modifyLabels(id, addedLabelIds = [], removedLabelIds = [], newHistoryId) {
    const msg = this.messages.get(id);
    if (msg) {
      const labels = new Set(msg.labelIds || []);
      for (const l of addedLabelIds) labels.add(l);
      for (const l of removedLabelIds) labels.delete(l);
      msg.labelIds = Array.from(labels);
    }
    if (newHistoryId) {
      this.historyId = String(newHistoryId);
      const record = { id: String(newHistoryId) };
      if (addedLabelIds.length > 0) {
        record.labelsAdded = [{ message: { id }, labelIds: addedLabelIds }];
      }
      if (removedLabelIds.length > 0) {
        record.labelsRemoved = [{ message: { id }, labelIds: removedLabelIds }];
      }
      this.historyRecords.push(record);
    }
  }

  /**
   * Helper method for tests to simulate history purge / gap.
   */
  expireHistoryBefore(cutoffHistoryId) {
    this.minHistoryId = String(cutoffHistoryId);
    this.historyRecords = this.historyRecords.filter(
      (h) => BigInt(h.id) >= BigInt(cutoffHistoryId)
    );
  }
}

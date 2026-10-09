import { Message } from "./message.mjs";

/**
 * In-memory state store maintaining normalized mailbox state and history cursor.
 */
export class MailboxStore {
  constructor(initial = {}) {
    this.lastHistoryId = initial.lastHistoryId ? String(initial.lastHistoryId) : null;
    this.messages = new Map();

    if (Array.isArray(initial.messages)) {
      for (const msg of initial.messages) {
        this.upsertMessage(msg);
      }
    }
  }

  getHistoryId() {
    return this.lastHistoryId;
  }

  setHistoryId(historyId) {
    if (historyId !== null && historyId !== undefined) {
      this.lastHistoryId = String(historyId);
    }
  }

  /**
   * Helper to ensure history ID is updated to the maximum numeric history ID seen.
   */
  advanceHistoryId(historyId) {
    if (!historyId) return;
    const newIdStr = String(historyId);
    if (!this.lastHistoryId) {
      this.lastHistoryId = newIdStr;
      return;
    }
    try {
      const currentBig = BigInt(this.lastHistoryId);
      const newBig = BigInt(newIdStr);
      if (newBig > currentBig) {
        this.lastHistoryId = newIdStr;
      }
    } catch (_err) {
      this.lastHistoryId = newIdStr;
    }
  }

  getMessage(id) {
    return this.messages.get(id) || null;
  }

  getAllMessages() {
    return Array.from(this.messages.values());
  }

  upsertMessage(message) {
    if (!(message instanceof Message)) {
      throw new TypeError("Value must be an instance of Message");
    }
    this.messages.set(message.id, message);
    if (message.historyId) {
      this.advanceHistoryId(message.historyId);
    }
  }

  removeMessage(id) {
    this.messages.delete(id);
  }

  modifyLabels(id, addedLabelIds = [], removedLabelIds = []) {
    const existing = this.messages.get(id);
    if (!existing) {
      return null;
    }

    const currentLabels = new Set(existing.labelIds || []);
    for (const labelId of addedLabelIds) {
      currentLabels.add(labelId);
    }
    for (const labelId of removedLabelIds) {
      currentLabels.delete(labelId);
    }

    const updatedMessage = new Message({
      id: existing.id,
      threadId: existing.threadId,
      historyId: existing.historyId,
      labelIds: Array.from(currentLabels),
      snippet: existing.snippet,
      internalDate: existing.internalDate,
      from: existing.from,
      to: existing.to,
      cc: existing.cc,
      bcc: existing.bcc,
      subject: existing.subject,
      messageIdHeader: existing.messageIdHeader,
      date: existing.date,
      textContent: existing.textContent,
      htmlContent: existing.htmlContent,
    });

    this.messages.set(id, updatedMessage);
    return updatedMessage;
  }

  /**
   * Completely replaces store state during full reconciliation sync.
   */
  reconcile({ historyId, messages = [] }) {
    this.messages.clear();
    this.lastHistoryId = historyId ? String(historyId) : null;
    for (const msg of messages) {
      this.upsertMessage(msg);
    }
  }
}

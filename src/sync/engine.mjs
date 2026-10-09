import { Message } from "../domain/message.mjs";
import { StaleHistoryError } from "../provider/errors.mjs";

/**
 * Synchronization Engine for Gmail mailbox synchronization and reconciliation.
 */
export class SyncEngine {
  constructor({ provider, store }) {
    if (!provider) throw new TypeError("SyncEngine requires a provider adapter");
    if (!store) throw new TypeError("SyncEngine requires a MailboxStore instance");
    this.provider = provider;
    this.store = store;
  }

  /**
   * Executes a full reconciliation sync from the provider.
   * Clears/overwrites mailbox state with full provider state.
   */
  async reconcile(options = {}) {
    const { recovered = false, reason = null } = options;

    // Fetch initial profile/history cursor and list of all message headers/ids
    const profile = await this.provider.getProfile();
    const rawMessageSummaries = await this.provider.listAllMessages();

    // Fetch full payload for each message
    const domainMessages = [];
    for (const summary of rawMessageSummaries) {
      const rawMsg = await this.provider.getMessage(summary.id);
      if (rawMsg) {
        domainMessages.push(Message.fromGmailPayload(rawMsg));
      }
    }

    const latestHistoryId = profile.historyId ? String(profile.historyId) : this.store.getHistoryId();

    this.store.reconcile({
      historyId: latestHistoryId,
      messages: domainMessages,
    });

    return {
      type: "full",
      messagesSynced: domainMessages.length,
      historyId: this.store.getHistoryId(),
      recovered,
      reason,
    };
  }

  /**
   * Executes an incremental sync using history records since store.getHistoryId().
   * Automatically falls back to full reconciliation if history cursor is stale or missing.
   */
  async sync() {
    const currentHistoryId = this.store.getHistoryId();
    if (!currentHistoryId) {
      return this.reconcile({ recovered: false, reason: "no_initial_history_id" });
    }

    let historyResult;
    try {
      historyResult = await this.provider.listHistory({ startHistoryId: currentHistoryId });
    } catch (err) {
      if (err instanceof StaleHistoryError || err.name === "StaleHistoryError") {
        return this.reconcile({ recovered: true, reason: "stale_history" });
      }
      throw err;
    }

    if (!historyResult || historyResult.stale) {
      return this.reconcile({ recovered: true, reason: "stale_history" });
    }

    const historyRecords = historyResult.history || [];
    let recordsProcessed = 0;

    for (const record of historyRecords) {
      recordsProcessed++;

      // 1. Process messagesAdded
      if (Array.isArray(record.messagesAdded)) {
        for (const item of record.messagesAdded) {
          if (item.message && item.message.id) {
            const rawMsg = await this.provider.getMessage(item.message.id);
            if (rawMsg) {
              this.store.upsertMessage(Message.fromGmailPayload(rawMsg));
            }
          }
        }
      }

      // 2. Process messagesDeleted
      if (Array.isArray(record.messagesDeleted)) {
        for (const item of record.messagesDeleted) {
          if (item.message && item.message.id) {
            this.store.removeMessage(item.message.id);
          }
        }
      }

      // 3. Process labelsAdded
      if (Array.isArray(record.labelsAdded)) {
        for (const item of record.labelsAdded) {
          if (item.message && item.message.id) {
            const msgId = item.message.id;
            const labelIds = item.labelIds || [];
            let existing = this.store.getMessage(msgId);
            if (!existing) {
              const rawMsg = await this.provider.getMessage(msgId);
              if (rawMsg) {
                this.store.upsertMessage(Message.fromGmailPayload(rawMsg));
                existing = this.store.getMessage(msgId);
              }
            }
            if (existing) {
              this.store.modifyLabels(msgId, labelIds, []);
            }
          }
        }
      }

      // 4. Process labelsRemoved
      if (Array.isArray(record.labelsRemoved)) {
        for (const item of record.labelsRemoved) {
          if (item.message && item.message.id) {
            const msgId = item.message.id;
            const labelIds = item.labelIds || [];
            const existing = this.store.getMessage(msgId);
            if (existing) {
              this.store.modifyLabels(msgId, [], labelIds);
            }
          }
        }
      }
    }

    // Advance history ID if provided in history result
    if (historyResult.historyId) {
      this.store.advanceHistoryId(historyResult.historyId);
    }

    return {
      type: "incremental",
      historyRecordsProcessed: recordsProcessed,
      historyId: this.store.getHistoryId(),
      recovered: false,
      reason: null,
    };
  }
}

import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { lowStockAlerts } from "./low-stock-alerts";

/**
 * Per-recipient delivery ledger for low-stock alert emails (GP-30 / T-3.5,
 * migration 0035). A retry sends only to recipients missing from this
 * ledger, so partially-delivered alerts can be retried without re-sending
 * to already-served inboxes. The unique key IS the dedup guard.
 */
export const lowStockAlertRecipients = pgTable(
  "low_stock_alert_recipients",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    alertId: uuid("alert_id")
      .notNull()
      .references(() => lowStockAlerts.id, {
        onDelete: "cascade",
      }),

    recipientEmail: text("recipient_email").notNull(),

    sentAt: timestamp("sent_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("low_stock_alert_recipients_alert_email_unique").on(
      table.alertId,
      table.recipientEmail,
    ),
  ],
);

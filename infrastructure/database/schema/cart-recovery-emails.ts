import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { carts } from "./cart";
import { user } from "./auth";

/**
 * Durable queue for abandoned-cart recovery emails (T-5.1, migration 0037).
 * Mirrors the auth-email queue (0034): the rendered email is stored at
 * enqueue time, then the retry worker runs the identical
 * QUEUED -> SENDING(lease) -> SENT | QUEUED(backoff) | FAILED machine.
 *
 * The UNIQUE (cart_id, stage) key IS the duplicate-send guard (same
 * doctrine as the 0035 low-stock ledger): a stage is claimed exactly once
 * no matter how many times the scanner races. Both FKs cascade — an email
 * about a cart/user that no longer exists has no meaning (unlike the 0033
 * audit trail, which must outlive its subject).
 */
export const cartRecoveryEmails = pgTable(
  "cart_recovery_emails",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, {
        onDelete: "cascade",
      }),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),

    /** Reminder number within one cart lifecycle (1..max stages). */
    stage: integer("stage").notNull(),

    /** Snapshot of the recipient address at enqueue time. */
    recipientEmail: text("recipient_email").notNull(),

    /** Stored bodies: a retry replays byte-identical content. */
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text").notNull(),

    status: text("status").notNull().default("QUEUED"),

    attempts: integer("attempts").notNull().default(0),

    nextRetryAt: timestamp("next_retry_at", {
      mode: "date",
    }),

    lastError: text("last_error"),

    providerMessageId: text("provider_message_id"),

    createdAt: timestamp("created_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    sentAt: timestamp("sent_at", {
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("cart_recovery_emails_cart_stage_unique").on(table.cartId, table.stage),
    index("cart_recovery_emails_user_idx").on(table.userId),
    index("cart_recovery_emails_status_idx").on(table.status),
  ],
);

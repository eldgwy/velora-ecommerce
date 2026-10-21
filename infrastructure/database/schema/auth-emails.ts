import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Durable queue for Better Auth verification / password-reset emails
 * (GP-14 / T-3.3, migration 0034). One row per send request; the rendered
 * email is stored at enqueue time and retried by the auth-email worker with
 * the same QUEUED -> SENDING(lease) -> SENT | QUEUED(backoff) | FAILED
 * machine the order-retry worker runs.
 *
 * The FK cascades into the user account on purpose: an email about an
 * account that no longer exists has no recipient (unlike the audit trail in
 * 0033, which must OUTLIVE the account).
 */
export const authEmails = pgTable(
  "auth_emails",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),

    /** VERIFICATION | PASSWORD_RESET */
    eventType: text("event_type").notNull(),

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
    index("auth_emails_user_idx").on(table.userId),

    index("auth_emails_status_idx").on(table.status),
  ],
);

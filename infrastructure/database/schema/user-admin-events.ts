import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Durable audit trail for customer-admin account operations (GP-25 / T-2.3,
 * migration 0033). One row per status/role change.
 *
 * `userId` is intentionally NOT a foreign key: audit rows must survive the
 * account they describe (account deletion is a later, product-gated GDPR
 * decision), and the user table's primary key is text (Better Auth). Actor
 * columns reuse the order-ledger vocabulary (0017/0032): "admin" | "system".
 */
export const userAdminEvents = pgTable(
  "user_admin_events",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    userId: text("user_id").notNull(),

    /** STATUS_CHANGED | ROLE_CHANGED */
    eventType: text("event_type").notNull(),

    previousValue: text("previous_value"),

    newValue: text("new_value").notNull(),

    actorType: text("actor_type"),

    /** The acting admin id, always from the verified server session. */
    actorId: text("actor_id").notNull(),

    reason: text("reason"),

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
  },
  (table) => [
    index("user_admin_events_user_idx").on(
      table.userId,
    ),

    index("user_admin_events_created_idx").on(
      table.createdAt,
    ),
  ],
);

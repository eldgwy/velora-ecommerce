import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { orders, orderItems, refunds } from "./orders";
import { productVariants } from "./catalog";

/**
 * Product returns (physical goods) — deliberately separate from monetary
 * refunds (`refunds`). A refund never creates a return case and never
 * restocks; goods re-enter stock only through the verified path
 * request → receipt → inspection → approval → `restockReturn`.
 *
 * Case lifecycle: OPEN → COMPLETED | CANCELLED.
 * Item lifecycle: PENDING → RECEIVED → APPROVED → RESTOCKED, with REJECTED
 * and CANCELLED as terminals. `condition` is recorded at inspection:
 * RESTOCKABLE goods may be approved; DAMAGED goods must be rejected.
 */
export const returnCases = pgTable(
  "return_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "restrict",
      }),

    // Optional link to the financial workflow. Informational only: setting
    // it never moves money, and issuing a refund never creates a case.
    refundId: uuid("refund_id").references(() => refunds.id, {
      onDelete: "set null",
    }),

    status: text("status").notNull().default("OPEN"),

    reason: text("reason").notNull(),

    createdBy: text("created_by"),

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

    completedAt: timestamp("completed_at", {
      mode: "date",
    }),
  },
  (table) => [
    index("return_cases_order_id_idx").on(table.orderId),

    index("return_cases_status_idx").on(table.status),

    check(
      "return_cases_status_allowed",
      sql`"status" IN ('OPEN', 'COMPLETED', 'CANCELLED')`,
    ),
  ],
);

export const returnItems = pgTable(
  "return_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    caseId: uuid("case_id")
      .notNull()
      .references(() => returnCases.id, {
        onDelete: "cascade",
      }),

    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, {
        onDelete: "restrict",
      }),

    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "restrict",
      }),

    quantity: integer("quantity").notNull(),

    status: text("status").notNull().default("PENDING"),

    // Inspection outcome. NULL until inspected. Only RESTOCKABLE lines may
    // be approved; DAMAGED lines must be rejected and are never restocked.
    condition: text("condition"),

    // Set atomically with the RETURN movement in the same transaction.
    // A non-null value means this line already restocked: concurrent or
    // retried attempts observe it under a row lock and return idempotently.
    restockedMovementId: uuid("restocked_movement_id"),

    processedBy: text("processed_by"),

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
    index("return_items_case_id_idx").on(table.caseId),

    index("return_items_order_item_id_idx").on(table.orderItemId),

    index("return_items_status_idx").on(table.status),

    // One return item restocks at most once: the movement link is unique.
    uniqueIndex("return_items_movement_unique").on(
      table.restockedMovementId,
    ),

    check("return_items_quantity_positive", sql`"quantity" > 0`),

    check(
      "return_items_status_allowed",
      sql`"status" IN ('PENDING', 'RECEIVED', 'APPROVED', 'REJECTED', 'RESTOCKED', 'CANCELLED')`,
    ),

    check(
      "return_items_condition_allowed",
      sql`"condition" IS NULL OR "condition" IN ('RESTOCKABLE', 'DAMAGED')`,
    ),

    // Only stock-eligible lines may carry a movement link.
    check(
      "return_items_movement_requires_restocked",
      sql`"restocked_movement_id" IS NULL OR "status" = 'RESTOCKED'`,
    ),
  ],
);

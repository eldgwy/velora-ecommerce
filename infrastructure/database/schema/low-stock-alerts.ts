import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";

import { inventory } from "./inventory";
import { lowStockAlertStatusEnum } from "./enums";

export const lowStockAlerts = pgTable(
  "low_stock_alerts",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    inventoryId: uuid("inventory_id")
      .notNull()
      .references(() => inventory.id, {
        onDelete: "cascade",
      }),

    variantId: uuid("variant_id").notNull(),

    availableStock: integer("available_stock").notNull(),

    threshold: integer("threshold").notNull(),

    status: lowStockAlertStatusEnum("status").notNull().default("PENDING"),

    attempts: integer("attempts").notNull().default(0),

    lastAttemptAt: timestamp("last_attempt_at", {
      mode: "date",
    }),

    deliveredAt: timestamp("delivered_at", {
      mode: "date",
    }),

    errorMessage: text("error_message"),

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
    index("low_stock_alerts_inventory_id_idx").on(table.inventoryId),

    index("low_stock_alerts_variant_id_idx").on(table.variantId),

    index("low_stock_alerts_status_idx").on(table.status),

    index("low_stock_alerts_created_at_idx").on(table.createdAt),

    // Prevent duplicate pending alerts for the same variant
    uniqueIndex("low_stock_alerts_variant_pending_unique")
      .on(table.variantId)
      .where(sql`status IN ('PENDING', 'PROCESSING')`),
  ],
);
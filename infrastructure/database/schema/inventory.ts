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

import { inventoryMovementTypeEnum } from "./enums";
import { productVariants } from "./catalog";

export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, {
        onDelete: "cascade",
      }),

    quantity: integer("quantity").notNull(),

    reservedQuantity: integer("reserved_quantity")
      .notNull()
      .default(0),

    lowStockThreshold: integer("low_stock_threshold"),

    location: text("location"),

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
    uniqueIndex("inventory_variant_id_unique").on(
      table.variantId,
    ),

    index("inventory_quantity_idx").on(
      table.quantity,
    ),

     index("inventory_quantity_threshold_idx").on(
       table.quantity,
       table.lowStockThreshold,
     ),

     // FR-05 Phase 2: defense-in-depth availability invariants (mirror the
     // app-level FOR UPDATE enforcement). Kept in-sync with migration 0007.
     check("inventory_quantity_non_negative", sql`"quantity" >= 0`),
     check("inventory_reserved_non_negative", sql`"reserved_quantity" >= 0`),
     check("inventory_reserved_le_quantity", sql`"reserved_quantity" <= "quantity"`),
   ],
);

export const inventoryMovements = pgTable(
  "inventory_movement",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    inventoryId: uuid("inventory_id")
      .notNull()
      .references(() => inventory.id, {
        onDelete: "cascade",
      }),

    quantity: integer("quantity").notNull(),

    type: inventoryMovementTypeEnum("type")
      .notNull(),

    reason: text("reason"),

    notes: text("notes"),

    // Audit trail (migration 0032): acting principal for this movement,
    // same actor vocabulary as the order ledger (order_status_histories,
    // migration 0017). Nullable — historical rows and automation without a
    // principal stay NULL rather than a fabricated identifier.
    actorType: text("actor_type"),

    actorId: text("actor_id"),

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
    index("inventory_movement_inventory_id_idx").on(
      table.inventoryId,
    ),

    index("inventory_movement_inventory_created_idx").on(
      table.inventoryId,
      table.createdAt,
    ),

    index("inventory_movement_type_idx").on(
      table.type,
    ),

    index("inventory_movement_created_at_idx").on(
      table.createdAt,
    ),

    index("inventory_movement_actor_id_idx").on(
      table.actorId,
    ),
  ],
);
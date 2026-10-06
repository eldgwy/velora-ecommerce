import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
  ],
);
import { sql } from "drizzle-orm";

import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const customerProfiles = pgTable(
  "customer_profile",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    firstName: text("first_name").notNull(),

    middleName: text("middle_name"),

    lastName: text("last_name").notNull(),

    phone: text("phone"),

    birthday: timestamp("birthday", {
      mode: "date",
    }),

    preferredLanguage: text("preferred_language"),

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

    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, {
        onDelete: "cascade",
      }),
  },
  (table) => [
    uniqueIndex("customer_profile_user_id_unique").on(
      table.userId,
    ),

    index("customer_profile_phone_idx").on(table.phone),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    country: text("country").notNull(),

    city: text("city").notNull(),

    state: text("state").notNull(),

    postalCode: text("postal_code").notNull(),

    label: text("label").notNull(),

    addressLine1: text("address_line1"),

    addressLine2: text("address_line2"),

    addressLine3: text("address_line3"),

    isDefault: boolean("is_default")
      .notNull()
      .default(false),

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

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customerProfiles.id, {
        onDelete: "cascade",
      }),
  },
  (table) => [
    index("addresses_customer_id_idx").on(
      table.customerId,
    ),

    /**
     * SRS FR-02.02 — "Default Address Invariant": at most one address per
     * customer may be the default. A partial unique index makes the database
     * the authority, so concurrent requests cannot leave two defaults
     * committed. The service layer clears siblings inside a transaction
     * before promoting the target, so the index is never violated mid-way.
     */
    uniqueIndex("addresses_customer_id_is_default_unique_idx")
      .on(table.customerId)
      .where(sql`is_default = true`),
  ],
);
import { pgTable, text, integer, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Rate limit table for Better Auth.
 * Stores rate limit keys (IP, user ID, etc.) with request counts and timestamps.
 * Includes an `id` column as primary key to match Better Auth's generated schema.
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").default(1).notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [
    index("rate_limit_last_request_idx").on(table.lastRequest),
    uniqueIndex("rate_limit_key_unique").on(table.key),
  ],
);
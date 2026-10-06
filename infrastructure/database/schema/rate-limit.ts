import { pgTable, text, integer, index } from "drizzle-orm/pg-core";

/**
 * Rate limit table for Better Auth.
 * Stores rate limit keys (IP, user ID, etc.) with request counts and timestamps.
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    key: text("key").primaryKey(),
    count: integer("count").default(1).notNull(),
    lastRequest: integer("last_request").notNull(),
  },
  (table) => [index("rate_limit_last_request_idx").on(table.lastRequest)],
);
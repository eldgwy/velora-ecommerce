import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "@/infrastructure/database/schema";
import { sql } from "drizzle-orm";

export const TEST_DATABASE_URL =
  process.env.VELORA_TEST_DATABASE_URL ||
  "postgresql://velora_user:eldgwy@localhost:5432/velora_db";

// Shared-database test runs execute one file per worker (26+ workers).
// postgres-js defaults to 10 connections per pool, which oversubscribes a
// stock PostgreSQL `max_connections = 100` and produces cascading timeouts
// under full parallel load. Cap the pool: concurrency tests still overlap
// server-side (races are DB-enforced), clients merely queue.
export const testDb = drizzle(postgres(TEST_DATABASE_URL, { max: 3 }), { schema });
export type TestDb = typeof testDb;

export { sql };

export {
  categories,
  brands,
  products,
  productVariants,
  productImages,
  productOptions,
  productOptionValues,
  variantOptionValues,
} from "@/infrastructure/database/schema/catalog";
export { inventory, inventoryMovements } from "@/infrastructure/database/schema/inventory";
export { orders, orderItems, orderStatusHistories, webhookEvents, payments, refunds } from "@/infrastructure/database/schema/orders";
export { reviews, reviewImages } from "@/infrastructure/database/schema/reviews";
export {
  reviewStatusEnum,
  productStatusEnum,
  productVariantStatusEnum,
} from "@/infrastructure/database/schema/enums";

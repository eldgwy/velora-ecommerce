import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "@/infrastructure/database/schema";
import { sql } from "drizzle-orm";

export const TEST_DATABASE_URL =
  process.env.VELORA_TEST_DATABASE_URL ||
  "postgresql://velora_user:eldgwy@localhost:5432/velora_db";

export const testDb = drizzle(postgres(TEST_DATABASE_URL), { schema });
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

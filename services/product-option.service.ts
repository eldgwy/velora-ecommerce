import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import {
  productOptions,
  productOptionValues,
} from "@/infrastructure/database/schema/catalog";

// ============================================
// Types
// ============================================

export type OptionRow = typeof productOptions.$inferSelect;
export type OptionInsertData = Omit<typeof productOptions.$inferInsert, "createdAt" | "updatedAt">;
export type OptionPatch = Partial<Omit<OptionInsertData, "id">>;

export type OptionValueRow = typeof productOptionValues.$inferSelect;
export type OptionValueInsertData = Omit<typeof productOptionValues.$inferInsert, "createdAt" | "updatedAt">;

// ============================================
// Option CRUD
// ============================================

export async function listOptionsByProduct(
  productId: string,
): Promise<OptionRow[]> {
  return db
    .select()
    .from(productOptions)
    .where(eq(productOptions.productId, productId));
}

export async function getOptionById(
  id: string,
): Promise<OptionRow | null> {
  const [row] = await db
    .select()
    .from(productOptions)
    .where(eq(productOptions.id, id));
  return row ?? null;
}

export async function createOption(
  data: OptionInsertData,
): Promise<OptionRow> {
  const [created] = await db.insert(productOptions).values(data).returning();
  return created!;
}

export async function updateOption(
  id: string,
  patch: OptionPatch,
): Promise<OptionRow | null> {
  const [updated] = await db
    .update(productOptions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(productOptions.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteOption(
  id: string,
): Promise<boolean> {
  const result = await db.delete(productOptions).where(eq(productOptions.id, id)).returning();
  return result.length > 0;
}

// ============================================
// Option Value CRUD
// ============================================

export async function listOptionValuesByOption(
  optionId: string,
): Promise<OptionValueRow[]> {
  return db
    .select()
    .from(productOptionValues)
    .where(eq(productOptionValues.optionId, optionId));
}

export async function getOptionValueById(
  id: string,
): Promise<OptionValueRow | null> {
  const [row] = await db
    .select()
    .from(productOptionValues)
    .where(eq(productOptionValues.id, id));
  return row ?? null;
}

export async function createOptionValue(
  data: OptionValueInsertData,
): Promise<OptionValueRow> {
  const [created] = await db
    .insert(productOptionValues)
    .values(data)
    .returning();
  return created!;
}

export async function deleteOptionValue(
  id: string,
): Promise<boolean> {
  const result = await db
    .delete(productOptionValues)
    .where(eq(productOptionValues.id, id))
    .returning();
  return result.length > 0;
}
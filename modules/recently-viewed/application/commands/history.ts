import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import { productViewHistory } from "@/infrastructure/database/schema/browsing-history";
import { HISTORY_LIMIT } from "@/modules/recently-viewed/domain/history-rules";

export class ProductNotViewableError extends Error {
  constructor(productId: string) {
    super(`Product cannot be recorded in history: ${productId}`);
    this.name = "ProductNotViewableError";
  }
}

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A view counts only for existing, ACTIVE products (no admin previews). */
async function assertViewableProduct(
  tx: TxClient,
  productId: string,
): Promise<void> {
  const [product] = await tx
    .select({ id: products.id, status: products.status })
    .from(products)
    .where(eq(products.id, productId));
  if (!product || product.status !== "ACTIVE") {
    throw new ProductNotViewableError(productId);
  }
}

async function upsertView(
  tx: TxClient,
  userId: string,
  productId: string,
  viewedAt: Date,
): Promise<void> {
  // GREATEST keeps the newest timestamp on conflict: a stale guest entry
  // merged later can never push a fresher server view backwards. The raw
  // fragment binds an ISO wall (this driver cannot bind Date objects
  // inside `sql` templates).
  await tx
    .insert(productViewHistory)
    .values({ userId, productId, viewedAt })
    .onConflictDoUpdate({
      target: [productViewHistory.userId, productViewHistory.productId],
      set: {
        viewedAt: sql`GREATEST(${productViewHistory.viewedAt}, ${viewedAt.toISOString()}::timestamptz)`,
      },
    });
}

/** Prune rows beyond the per-customer limit (oldest first). */
async function pruneHistory(tx: TxClient, userId: string): Promise<void> {
  await tx.execute(sql`
    DELETE FROM product_view_history AS h
    USING (
      SELECT id FROM product_view_history
      WHERE user_id = ${userId}
      ORDER BY viewed_at DESC, id DESC
      OFFSET ${HISTORY_LIMIT}
    ) AS old
    WHERE h.id = old.id
  `);
}

/**
 * Record a product view: upsert the (customer, product) row and prune past
 * the limit, atomically. The unique constraint arbitrates concurrent
 * repeat views — no duplicates, recency always refreshes.
 */
export async function recordProductView(
  userId: string,
  productId: string,
  viewedAt: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await assertViewableProduct(tx, productId);
    await upsertView(tx, userId, productId, viewedAt);
    await pruneHistory(tx, userId);
  });
}

/**
 * Merge validated guest entries into the account history (sign-in merge).
 * Each id is re-checked against the catalog; unknown/inactive products are
 * skipped. Guest timestamps are preserved (clamped to now) so merged order
 * reflects actual browsing recency. Fully idempotent — safe to repeat.
 */
export async function mergeGuestHistory(
  userId: string,
  entries: Array<{ id: string; at: number }>,
  now: Date = new Date(),
): Promise<{ merged: number }> {
  // Dedupe first (keeping the newest timestamp per id): the loop below
  // counts processed ids against HISTORY_LIMIT, so duplicates can neither
  // exhaust the budget nor inflate the merged count.
  const newest = new Map<string, number>();
  for (const entry of entries) {
    const prev = newest.get(entry.id);
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
    if (prev === undefined || at > prev) newest.set(entry.id, at);
  }
  const ids = [...newest.keys()].slice(0, HISTORY_LIMIT);
  if (ids.length === 0) return { merged: 0 };
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: products.id, status: products.status })
      .from(products)
      .where(inArray(products.id, ids));
    const viewable = new Map(
      rows.filter((r) => r.status === "ACTIVE").map((r) => [r.id, r] as const),
    );
    let merged = 0;
    for (const id of ids) {
      if (!viewable.has(id)) continue;
      const raw = newest.get(id) ?? 0;
      const at = new Date(Math.min(raw, now.getTime()) || now.getTime());
      await upsertView(tx, userId, id, Number.isNaN(at.getTime()) ? now : at);
      merged += 1;
    }
    await pruneHistory(tx, userId);
    return { merged };
  });
}

/**
 * Remove one entry. Scoped to the caller's rows — a forged product id can
 * only ever affect the caller's own history. Absent rows resolve false.
 */
export async function removeHistoryEntry(
  userId: string,
  productId: string,
): Promise<{ removed: boolean }> {
  const deleted = await db
    .delete(productViewHistory)
    .where(
      and(
        eq(productViewHistory.userId, userId),
        eq(productViewHistory.productId, productId),
      ),
    )
    .returning({ id: productViewHistory.id });
  return { removed: deleted.length > 0 };
}

/** Clear the caller's history. Scoped; idempotent. */
export async function clearHistory(userId: string): Promise<{ cleared: number }> {
  const deleted = await db
    .delete(productViewHistory)
    .where(eq(productViewHistory.userId, userId))
    .returning({ id: productViewHistory.id });
  return { cleared: deleted.length };
}

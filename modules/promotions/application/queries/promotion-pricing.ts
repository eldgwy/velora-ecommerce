import { and, eq, inArray, lte } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { productVariants, products } from "@/infrastructure/database/schema/catalog";
import {
  promotionProducts,
  promotions,
} from "@/infrastructure/database/schema/discounts";
import { toMinorUnits } from "@/modules/checkout/domain/money";
import {
  selectBestPromotion,
  type PromotionCandidate,
} from "@/modules/promotions/domain/promotion-rules";

export interface VariantPromotionView {
  variantId: string;
  productId: string;
  /** Authoritative list price (variant override else product base). */
  listPriceCents: number;
  /** Effective price after the winning promotion (equals list when none). */
  effectiveCents: number;
  savingCents: number;
  promotionId: string | null;
  promotionName: string | null;
  promotionEndsAt: Date | null;
}

export interface ProductPromotionSummary {
  productId: string;
  /** Lowest effective unit price across purchasable variants, if known. */
  minEffectiveCents: number | null;
  hasDiscount: boolean;
  promotionName: string | null;
  promotionEndsAt: Date | null;
}

interface CandidateWithEndsAt extends PromotionCandidate {
  endsAt: Date | null;
}

async function fetchCandidates(
  productIds: string[],
  now: Date,
): Promise<Map<string, CandidateWithEndsAt[]>> {
  const map = new Map<string, CandidateWithEndsAt[]>();
  if (productIds.length === 0) return map;
  const rows = await db
    .select({
      productId: promotionProducts.productId,
      id: promotions.id,
      name: promotions.name,
      type: promotions.type,
      value: promotions.value,
      endsAt: promotions.endsAt,
    })
    .from(promotionProducts)
    .innerJoin(promotions, eq(promotionProducts.promotionId, promotions.id))
    .where(
      and(
        inArray(promotionProducts.productId, productIds),
        eq(promotions.isActive, true),
        lte(promotions.startsAt, now),
      ),
    )
    .orderBy(promotions.id);
  const nowMs = now.getTime();
  for (const row of rows) {
    // Open-ended (NULL endsAt) stays eligible; ended ones drop out here so
    // no scheduled job is ever needed to expire a promotion.
    if (row.endsAt !== null && row.endsAt.getTime() < nowMs) continue;
    const list = map.get(row.productId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      type: row.type,
      value: row.value,
      endsAt: row.endsAt,
    });
    map.set(row.productId, list);
  }
  return map;
}

function toCentsSafe(raw: string): number | null {
  try {
    const cents = toMinorUnits(raw, "USD");
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

/**
 * Promotion views for explicit variants (detail pages, variant selectors).
 * One batched mapping query for all products — never per-variant.
 * Unpurchasable variants report list price with no promotion.
 */
export async function getVariantPromotionViews(
  variants: Array<{
    variantId: string;
    productId: string;
    listPrice: string;
    purchasable: boolean;
  }>,
  now: Date = new Date(),
): Promise<Map<string, VariantPromotionView>> {
  const views = new Map<string, VariantPromotionView>();
  const candidates = await fetchCandidates(
    [...new Set(variants.map((v) => v.productId))],
    now,
  );
  for (const v of variants) {
    const listPriceCents = toCentsSafe(v.listPrice) ?? 0;
    const base: VariantPromotionView = {
      variantId: v.variantId,
      productId: v.productId,
      listPriceCents,
      effectiveCents: listPriceCents,
      savingCents: 0,
      promotionId: null,
      promotionName: null,
      promotionEndsAt: null,
    };
    if (!v.purchasable || listPriceCents <= 0) {
      views.set(v.variantId, base);
      continue;
    }
    const productCandidates = candidates.get(v.productId) ?? [];
    const winner = selectBestPromotion(listPriceCents, productCandidates);
    if (!winner) {
      views.set(v.variantId, base);
      continue;
    }
    views.set(v.variantId, {
      ...base,
      effectiveCents: winner.effectiveCents,
      savingCents: winner.savingCents,
      promotionId: winner.id,
      promotionName: winner.name,
      promotionEndsAt:
        productCandidates.find((c) => c.id === winner.id)?.endsAt ?? null,
    });
  }
  return views;
}

/**
 * Per-product summaries for grids (listing/search pages). ACTIVE variant
 * prices, base prices, and mappings load in three batched queries — no
 * per-card queries. Summaries derive from the same centralized selection
 * as checkout, so displayed and charged prices agree.
 */
export async function getProductPromotionSummaries(
  productIds: string[],
  now: Date = new Date(),
): Promise<Map<string, ProductPromotionSummary>> {
  const summaries = new Map<string, ProductPromotionSummary>();
  if (productIds.length === 0) return summaries;

  const [variantRows, baseRows, candidates] = await Promise.all([
    db
      .select({
        variantId: productVariants.id,
        productId: productVariants.productId,
        priceOverride: productVariants.priceOverride,
      })
      .from(productVariants)
      .where(
        and(
          inArray(productVariants.productId, productIds),
          eq(productVariants.status, "ACTIVE"),
        ),
      ),
    db
      .select({ id: products.id, basePrice: products.basePrice })
      .from(products)
      .where(inArray(products.id, productIds)),
    fetchCandidates(productIds, now),
  ]);
  const baseMap = new Map(baseRows.map((r) => [r.id, r.basePrice]));

  for (const productId of productIds) {
    const productCandidates = candidates.get(productId) ?? [];
    let summary: ProductPromotionSummary = {
      productId,
      minEffectiveCents: null,
      hasDiscount: false,
      promotionName: null,
      promotionEndsAt: null,
    };
    for (const v of variantRows) {
      if (v.productId !== productId) continue;
      const listCents = toCentsSafe(v.priceOverride ?? baseMap.get(productId) ?? "0");
      if (listCents === null) continue;
      const winner = selectBestPromotion(listCents, productCandidates);
      const effective = winner ? winner.effectiveCents : listCents;
      if (summary.minEffectiveCents === null || effective < summary.minEffectiveCents) {
        summary = {
          productId,
          minEffectiveCents: effective,
          hasDiscount: winner !== null,
          promotionName: winner?.name ?? null,
          promotionEndsAt:
            productCandidates.find((c) => c.id === winner?.id)?.endsAt ?? null,
        };
      }
    }
    if (summary.minEffectiveCents !== null) summaries.set(productId, summary);
  }
  return summaries;
}

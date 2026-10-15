import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { products } from "@/infrastructure/database/schema/catalog";
import {
  promotionProducts,
  promotions,
} from "@/infrastructure/database/schema/discounts";
import { assertMajorDecimal, assertPercentageValue } from "@/modules/coupons/domain/coupon-rules";
import { CouponValidationError } from "@/modules/coupons/domain/coupon-errors";
import type { PromotionKind } from "@/modules/promotions/domain/promotion-rules";
import {
  PromotionConflictError,
  PromotionNotFoundError,
  PromotionValidationError,
} from "@/modules/promotions/domain/promotion-errors";
import { invalidateProductCache } from "@/shared/lib/cache/tags";

export interface PromotionTermsInput {
  name: string;
  description?: string | null;
  type: PromotionKind;
  /** Major-unit decimal string: percent (0,100] or fixed amount (>0, ≤2dp). */
  value: string;
  startsAt?: Date | null;
  /** NULL = open-ended (never expires by time). */
  endsAt?: Date | null;
  isActive?: boolean;
}

/** Rebrand reused coupon decimal checks as promotion-domain errors. */
function checkedValue<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof CouponValidationError) {
      throw new PromotionValidationError(error.message);
    }
    throw error;
  }
}

function validateTerms(input: PromotionTermsInput) {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    throw new PromotionValidationError("Promotion name is required (max 120 characters).");
  }
  if (input.type !== "PERCENTAGE" && input.type !== "FIXED") {
    throw new PromotionValidationError("Promotion type must be PERCENTAGE or FIXED.");
  }
  const value = checkedValue(() =>
    input.type === "PERCENTAGE"
      ? assertPercentageValue(input.value.trim())
      : assertMajorDecimal(input.value.trim(), "Fixed value", { maxDecimals: 2 }),
  );
  // `starts_at` is NOT NULL in storage: a missing start means "active from
  // creation". `endsAt` stays nullable (open-ended promotion).
  const startsAt = input.startsAt ?? new Date();
  const endsAt = input.endsAt ?? null;
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    throw new PromotionValidationError("Start time is invalid.");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new PromotionValidationError("Expiration time is invalid.");
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new PromotionValidationError("Expiration must be after activation.");
  }
  return {
    name,
    description: input.description?.trim() ? input.description.trim().slice(0, 1000) : null,
    value: value.toString(),
    startsAt,
    endsAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.code === "23505") return true;
      if (typeof record.message === "string" && record.message.includes("duplicate key value")) {
        return true;
      }
      current = "cause" in record ? record.cause : null;
      continue;
    }
    return false;
  }
  return false;
}

async function mappedProductIds(promotionId: string): Promise<string[]> {
  const rows = await db
    .select({ productId: promotionProducts.productId })
    .from(promotionProducts)
    .where(eq(promotionProducts.promotionId, promotionId));
  return rows.map((r) => r.productId);
}

async function invalidateMapped(productIds: string[]): Promise<void> {
  for (const productId of productIds) {
    try {
      await invalidateProductCache(productId);
    } catch (error) {
      // Commands also run outside Server Actions (tests, scripts, jobs)
      // where tag invalidation is unavailable; the time-based revalidate
      // window bounds staleness there. Anything else is a real failure.
      if (error instanceof Error && /Server Action/.test(error.message)) continue;
      throw error;
    }
  }
}

/**
 * Create a promotion. Does not apply to anything until products are mapped
 * and the window opens; pricing reads eligibility live, so no scheduler
 * ever toggles state.
 */
export async function createPromotion(input: PromotionTermsInput): Promise<{ id: string }> {
  const terms = validateTerms(input);
  const [created] = await db
    .insert(promotions)
    .values({
      name: terms.name,
      description: terms.description,
      type: input.type,
      value: terms.value,
      startsAt: terms.startsAt,
      endsAt: terms.endsAt,
      isActive: input.isActive ?? true,
    })
    .returning({ id: promotions.id });
  if (!created) throw new Error("Promotion insert failed");
  return { id: created.id };
}

export interface PromotionUpdateInput extends PromotionTermsInput {
  id: string;
  isActive: boolean;
}

/**
 * Update a promotion. Historical orders are safe: order items froze the
 * regular price, effective price, discount, and promotion name at creation.
 */
export async function updatePromotion(input: PromotionUpdateInput): Promise<void> {
  const terms = validateTerms(input);
  const updated = await db
    .update(promotions)
    .set({
      name: terms.name,
      description: terms.description,
      type: input.type,
      value: terms.value,
      startsAt: terms.startsAt,
      endsAt: terms.endsAt,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(promotions.id, input.id))
    .returning({ id: promotions.id });
  if (updated.length === 0) throw new PromotionNotFoundError(input.id);
  await invalidateMapped(await mappedProductIds(input.id));
}

/** Flip activation. Live pricing reads the flag; history untouched. */
export async function setPromotionActive(id: string, isActive: boolean): Promise<void> {
  const updated = await db
    .update(promotions)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(promotions.id, id))
    .returning({ id: promotions.id });
  if (updated.length === 0) throw new PromotionNotFoundError(id);
  await invalidateMapped(await mappedProductIds(id));
}

/**
 * Map a product to a promotion. Idempotent at the database level: a lost
 * race surfaces as a domain conflict, never a raw constraint error.
 */
export async function mapProductToPromotion(promotionId: string, productId: string): Promise<void> {
  const [promotion] = await db
    .select({ id: promotions.id })
    .from(promotions)
    .where(eq(promotions.id, promotionId));
  if (!promotion) throw new PromotionNotFoundError(promotionId);
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new PromotionValidationError("The selected product does not exist.");
  try {
    await db.insert(promotionProducts).values({ promotionId, productId });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PromotionConflictError("That product is already mapped to this promotion.");
    }
    throw error;
  }
  await invalidateProductCache(productId);
}

/** Remove a mapping. Paged prices update via invalidation; history frozen. */
export async function unmapProductFromPromotion(promotionId: string, productId: string): Promise<void> {
  await db
    .delete(promotionProducts)
    .where(
      and(
        eq(promotionProducts.promotionId, promotionId),
        eq(promotionProducts.productId, productId),
      ),
    );
  await invalidateProductCache(productId);
}

import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { coupons } from "@/infrastructure/database/schema/discounts";
import type { CouponKind } from "@/modules/checkout/domain/pricing";
import {
  assertMajorDecimal,
  assertPercentageValue,
  normalizeCouponCode,
} from "@/modules/coupons/domain/coupon-rules";
import {
  CouponConflictError,
  CouponNotFoundError,
  CouponValidationError,
} from "@/modules/coupons/domain/coupon-errors";

export interface CouponTermsInput {
  code: string;
  type: CouponKind;
  /** Major-unit decimal string: percent (0,100] or fixed amount (>0, ≤2dp). */
  value: string;
  /** Major-unit decimal string, ≥0. */
  minimumOrderAmount?: string | null;
  /** Major-unit decimal string, ≥0. Percentage-only. */
  maximumDiscountAmount?: string | null;
  usageLimit?: number | null;
  perUserLimit?: number | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  isActive?: boolean;
}

function assertOptionalInt(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new CouponValidationError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertWindow(startsAt: Date | null, expiresAt: Date | null): void {
  if (startsAt && Number.isNaN(startsAt.getTime())) throw new CouponValidationError("Start time is invalid.");
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new CouponValidationError("Expiration time is invalid.");
  if (startsAt && expiresAt && expiresAt.getTime() <= startsAt.getTime()) {
    throw new CouponValidationError("Expiration must be after activation.");
  }
}

/** Validate shared create/update terms; returns normalized storage values. */
function validateTerms(input: CouponTermsInput) {
  const code = normalizeCouponCode(input.code);
  if (input.type !== "PERCENTAGE" && input.type !== "FIXED") {
    throw new CouponValidationError("Coupon type must be PERCENTAGE or FIXED.");
  }
  const value =
    input.type === "PERCENTAGE"
      ? assertPercentageValue(input.value.trim())
      : assertMajorDecimal(input.value.trim(), "Fixed value", { maxDecimals: 2 });

  let minimumOrderAmount: string | null = null;
  if (input.minimumOrderAmount !== null && input.minimumOrderAmount !== undefined && input.minimumOrderAmount !== "") {
    const parsed = assertMajorDecimal(input.minimumOrderAmount.trim(), "Minimum order amount", {
      minExclusive: -1,
      maxDecimals: 2,
    });
    if (parsed.lt(0)) throw new CouponValidationError("Minimum order amount must not be negative.");
    minimumOrderAmount = parsed.toFixed(2);
  }

  let maximumDiscountAmount: string | null = null;
  if (input.maximumDiscountAmount !== null && input.maximumDiscountAmount !== undefined && input.maximumDiscountAmount !== "") {
    if (input.type !== "PERCENTAGE") {
      throw new CouponValidationError("Maximum discount applies to percentage coupons only.");
    }
    const parsed = assertMajorDecimal(input.maximumDiscountAmount.trim(), "Maximum discount", {
      minExclusive: -1,
      maxDecimals: 2,
    });
    if (parsed.lt(0)) throw new CouponValidationError("Maximum discount must not be negative.");
    maximumDiscountAmount = parsed.toFixed(2);
  }

  const usageLimit = assertOptionalInt(input.usageLimit, "Usage limit");
  const perUserLimit = assertOptionalInt(input.perUserLimit, "Per-user limit");
  const startsAt = input.startsAt ?? null;
  const expiresAt = input.expiresAt ?? null;
  assertWindow(startsAt, expiresAt);

  return {
    code,
    value: value.toString(),
    minimumOrderAmount,
    maximumDiscountAmount,
    usageLimit,
    perUserLimit,
    startsAt,
    expiresAt,
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

/**
 * Create a coupon. Code uniqueness is enforced by the database; a lost
 * insert race surfaces as a domain conflict, never a raw constraint error.
 */
export async function createCoupon(
  input: CouponTermsInput & { actorId: string },
): Promise<{ id: string }> {
  const terms = validateTerms(input);
  const isActive = input.isActive ?? true;
  try {
    const [created] = await db
      .insert(coupons)
      .values({
        code: terms.code,
        type: input.type,
        value: terms.value,
        minimumOrderAmount: terms.minimumOrderAmount,
        maximumDiscountAmount: terms.maximumDiscountAmount,
        usageLimit: terms.usageLimit,
        perUserLimit: terms.perUserLimit,
        startsAt: terms.startsAt,
        expiresAt: terms.expiresAt,
        isActive,
      })
      .returning({ id: coupons.id });
    if (!created) throw new Error("Coupon insert failed");
    return { id: created.id };
  } catch (error) {
    if (isUniqueViolation(error)) throw new CouponConflictError(terms.code);
    throw error;
  }
}

export interface CouponUpdateInput extends CouponTermsInput {
  id: string;
  isActive: boolean;
}

/**
 * Update a coupon. Historical orders are safe: discounts were snapshotted
 * into `couponusages` + order totals at creation, so edits never rewrite
 * history. The one incoherent edit — a usage limit below the already
 * consumed count — is rejected.
 */
export async function updateCoupon(input: CouponUpdateInput): Promise<void> {
  const terms = validateTerms(input);
  const [existing] = await db
    .select({ id: coupons.id, usageCount: coupons.usageCount })
    .from(coupons)
    .where(eq(coupons.id, input.id));
  if (!existing) throw new CouponNotFoundError(input.id);
  if (terms.usageLimit !== null && terms.usageLimit < existing.usageCount) {
    throw new CouponValidationError(
      `Usage limit cannot be below the ${existing.usageCount} uses already recorded. Deactivate the coupon instead.`,
    );
  }
  try {
    await db
      .update(coupons)
      .set({
        code: terms.code,
        type: input.type,
        value: terms.value,
        minimumOrderAmount: terms.minimumOrderAmount,
        maximumDiscountAmount: terms.maximumDiscountAmount,
        usageLimit: terms.usageLimit,
        perUserLimit: terms.perUserLimit,
        startsAt: terms.startsAt,
        expiresAt: terms.expiresAt,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(eq(coupons.id, input.id));
  } catch (error) {
    if (isUniqueViolation(error)) throw new CouponConflictError(terms.code);
    throw error;
  }
}

/** Flip the activation flag. Existing orders and snapshots are untouched. */
export async function setCouponActive(id: string, isActive: boolean): Promise<void> {
  const updated = await db
    .update(coupons)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(coupons.id, id))
    .returning({ id: coupons.id });
  if (updated.length === 0) throw new CouponNotFoundError(id);
}

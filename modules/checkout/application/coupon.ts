import { and, eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { coupons, couponUsages } from "@/infrastructure/database/schema/discounts";
import { CouponInvalidError } from "@/modules/checkout/domain/errors";
import { fromMinorUnits, toMinorUnits } from "@/modules/checkout/domain/money";
import {
  calculateCouponDiscountCents,
  type CouponKind,
} from "@/modules/checkout/domain/pricing";

export type DbLike = typeof db;
export type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ValidatedCoupon {
  id: string;
  code: string;
  type: CouponKind;
  value: string;
  maximumDiscountAmount: string | null;
  discountCents: number;
}

/**
 * FR-12.02 coupon eligibility, evaluated inside the order-creation
 * transaction with the coupon row locked (`FOR UPDATE`) so concurrent
 * checkouts cannot both consume the last usage. `usageCount` is incremented
 * by the caller only after the order row exists.
 *
 * Both limits are enforced here, in the same locked transaction that later
 * consumes the usage: the global `usageLimit` and the per-user
 * `perUserLimit` (counting live usage rows for this user — rows for
 * cancelled/failed/expired orders are released by the order lifecycle, so
 * they never count). A single consistent `now` must be supplied by the
 * caller for the validity window.
 */
export async function validateCouponForCheckout(
  tx: TxLike,
  code: string,
  subtotalCents: number,
  userId: string,
  now: Date = new Date(),
): Promise<ValidatedCoupon> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new CouponInvalidError("Coupon code is required.");

  const locked = await lockCouponRow(tx, normalized);
  if (!locked) throw new CouponInvalidError("That coupon code is not recognized.");

  if (!locked.isActive) throw new CouponInvalidError("That coupon is no longer active.");
  if (locked.startsAt !== null && locked.startsAt.getTime() > now.getTime()) {
    throw new CouponInvalidError("That coupon is not yet valid.");
  }
  if (locked.expiresAt !== null && locked.expiresAt.getTime() < now.getTime()) {
    throw new CouponInvalidError("That coupon has expired.");
  }
  if (locked.usageLimit !== null && locked.usageCount >= locked.usageLimit) {
    throw new CouponInvalidError("That coupon has reached its usage limit.");
  }
  if (locked.perUserLimit !== null) {
    const userUses = await countUserUsages(tx, locked.id, userId);
    if (userUses >= locked.perUserLimit) {
      throw new CouponInvalidError("You have already used this coupon the maximum number of times.");
    }
  }
  if (locked.minimumOrderAmount !== null) {
    let minimumCents: number;
    try {
      minimumCents = toMinorUnits(locked.minimumOrderAmount, "USD");
    } catch {
      throw new CouponInvalidError("That coupon is misconfigured. Contact support.");
    }
    if (subtotalCents < minimumCents) {
      throw new CouponInvalidError(
        "Your order does not meet this coupon's minimum amount.",
      );
    }
  }

  const discountCents = calculateCouponDiscountCents(subtotalCents, {
    type: locked.type,
    value: locked.value,
    maximumDiscountAmount: locked.maximumDiscountAmount,
  });
  if (discountCents <= 0) {
    throw new CouponInvalidError("That coupon does not apply to your order.");
  }

  return {
    id: locked.id,
    code: locked.code,
    type: locked.type,
    value: locked.value,
    maximumDiscountAmount: locked.maximumDiscountAmount,
    discountCents,
  };
}

interface LockedCoupon {
  id: string;
  code: string;
  type: CouponKind;
  value: string;
  minimumOrderAmount: string | null;
  maximumDiscountAmount: string | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
}

async function lockCouponRow(tx: TxLike, code: string): Promise<LockedCoupon | null> {
  const result = (await tx.execute(sql`
    SELECT id, code, type, value,
           minimum_order_amount AS "minimumOrderAmount",
           maximum_discount_amount AS "maximumDiscountAmount",
           usage_limit AS "usageLimit",
           per_user_limit AS "perUserLimit",
           usage_count AS "usageCount",
           starts_at AS "startsAt",
           expires_at AS "expiresAt",
           is_active AS "isActive"
    FROM coupons
    WHERE code = ${code}
    FOR UPDATE
  `)) as unknown as Array<{
    id: string;
    code: string;
    type: CouponKind;
    value: string;
    minimumOrderAmount: string | null;
    maximumDiscountAmount: string | null;
    usageLimit: number | null;
    perUserLimit: number | null;
    usageCount: number;
    startsAt: string | Date | null;
    expiresAt: string | Date | null;
    isActive: boolean;
  }>;
  const row = result[0];
  if (!row) return null;
  // Raw SQL returns `timestamp without time zone` as a wall-clock string.
  // Drizzle persists Date values as UTC walls, so reattach UTC explicitly:
  // naive `new Date(string)` would parse in server-local time and shift the
  // window by the UTC offset (e.g. EEST), expiring coupons early.
  return {
    ...row,
    usageCount: Number(row.usageCount),
    usageLimit: row.usageLimit === null ? null : Number(row.usageLimit),
    perUserLimit: row.perUserLimit === null ? null : Number(row.perUserLimit),
    startsAt: parseDbTimestamp(row.startsAt),
    expiresAt: parseDbTimestamp(row.expiresAt),
  };
}

/** Live usage rows for one user+coupon (released rows are deleted, never counted). */
async function countUserUsages(tx: TxLike, couponId: string, userId: string): Promise<number> {
  const rows = await tx
    .select({ id: couponUsages.id })
    .from(couponUsages)
    .where(and(eq(couponUsages.couponId, couponId), eq(couponUsages.userId, userId)));
  return rows.length;
}

/** Parse a DB timestamp wall (`"2026-10-12 20:15:26.032971"`) as UTC. */
function parseDbTimestamp(value: string | Date | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  return new Date(`${value.replace(" ", "T")}Z`);
}

/** Consume one coupon usage for a created order (same transaction). */
export async function consumeCouponUsage(
  tx: TxLike,
  couponId: string,
  userId: string,
  orderId: string,
  discountCents: number,
): Promise<void> {
  const [coupon] = await tx
    .select({
      code: coupons.code,
      type: coupons.type,
      value: coupons.value,
    })
    .from(coupons)
    .where(eq(coupons.id, couponId));
  await tx
    .update(coupons)
    .set({ usageCount: sql`${coupons.usageCount} + 1`, updatedAt: new Date() })
    .where(eq(coupons.id, couponId));
  await tx.insert(couponUsages).values({
    couponId,
    userId,
    orderId,
    discountAmount: fromMinorUnits(discountCents, "USD"),
    // Redemption snapshot: the order keeps explaining its discount even if
    // the coupon is renamed, edited, or deactivated later.
    code: coupon?.code ?? null,
    type: (coupon?.type ?? null) as CouponKind | null,
    value: coupon?.value ?? null,
  });
}

/**
 * Release an order's coupon capacity (cancel / payment failure / expiry).
 * Deletes the order's usage rows and decrements each affected coupon's
 * counter by exactly the deleted count (clamped at zero). Idempotent:
 * rows already gone mean nothing is decremented, so retries and duplicate
 * lifecycle calls can never drive counters negative or free phantom
 * capacity. Must run inside the caller's transaction so the release commits
 * atomically with the lifecycle transition it belongs to.
 */
export async function releaseCouponUsageForOrder(
  tx: TxLike,
  orderId: string,
): Promise<void> {
  const deleted = await tx
    .delete(couponUsages)
    .where(eq(couponUsages.orderId, orderId))
    .returning({ couponId: couponUsages.couponId });
  const perCoupon = new Map<string, number>();
  for (const row of deleted) {
    if (!row.couponId) continue;
    perCoupon.set(row.couponId, (perCoupon.get(row.couponId) ?? 0) + 1);
  }
  for (const [couponId, count] of perCoupon) {
    await tx
      .update(coupons)
      .set({
        usageCount: sql`GREATEST(${coupons.usageCount} - ${count}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(coupons.id, couponId));
  }
}

/** Roll back a consumed usage during reservation-failure compensation. */
export async function releaseCouponUsage(
  tx: TxLike,
  couponId: string,
  orderId: string,
): Promise<void> {
  await releaseCouponUsageForOrder(tx, orderId);
}

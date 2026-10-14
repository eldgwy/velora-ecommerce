import Decimal from "decimal.js";

import { CouponValidationError } from "./coupon-errors";

/**
 * Coupon code and status rules (domain layer — pure).
 *
 * Codes are normalized uppercase everywhere (creation, lookup, redemption);
 * the allowed alphabet is A–Z, 0–9, dash, underscore, 3–32 chars. Status is
 * derived from stored fields plus one consistent clock value — never stored.
 */

export const COUPON_CODE_PATTERN = /^[A-Z0-9-_]{3,32}$/;

export type CouponDisplayStatus =
  | "ACTIVE"
  | "SCHEDULED"
  | "EXPIRED"
  | "EXHAUSTED"
  | "INACTIVE";

/** Normalize raw input; throws on empty or out-of-alphabet codes. */
export function normalizeCouponCode(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  if (!COUPON_CODE_PATTERN.test(normalized)) {
    throw new CouponValidationError(
      "Coupon code must be 3–32 characters of A–Z, 0–9, dash, or underscore.",
    );
  }
  return normalized;
}

export interface CouponStatusInput {
  isActive: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  usageLimit: number | null;
  usageCount: number;
}

/** Single-clock display status for admin lists. */
export function deriveCouponStatus(
  coupon: CouponStatusInput,
  now: Date = new Date(),
): CouponDisplayStatus {
  if (!coupon.isActive) return "INACTIVE";
  if (coupon.startsAt !== null && coupon.startsAt.getTime() > now.getTime()) {
    return "SCHEDULED";
  }
  if (coupon.expiresAt !== null && coupon.expiresAt.getTime() <= now.getTime()) {
    return "EXPIRED";
  }
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    return "EXHAUSTED";
  }
  return "ACTIVE";
}

/** Validate a major-unit decimal string for coupon terms (exact, no float). */
export function assertMajorDecimal(
  raw: string,
  label: string,
  opts: { minExclusive?: number; maxDecimals?: number } = {},
): Decimal {
  let value: Decimal;
  try {
    value = new Decimal(raw);
  } catch {
    throw new CouponValidationError(`${label} must be a valid decimal amount.`);
  }
  if (!value.isFinite()) throw new CouponValidationError(`${label} must be a valid decimal amount.`);
  const min = opts.minExclusive ?? 0;
  if (value.lte(min)) throw new CouponValidationError(`${label} must be greater than ${min}.`);
  if (opts.maxDecimals !== undefined) {
    if (!value.mul(new Decimal(10).pow(opts.maxDecimals)).isInteger()) {
      throw new CouponValidationError(`${label} allows at most ${opts.maxDecimals} decimals.`);
    }
  }
  return value;
}

/** Percentage term bounds: (0, 100]. */
export function assertPercentageValue(raw: string): Decimal {
  const value = assertMajorDecimal(raw, "Percentage value");
  if (value.gt(100)) throw new CouponValidationError("Percentage value must not exceed 100.");
  return value;
}

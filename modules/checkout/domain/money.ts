import Decimal from "decimal.js";

/**
 * Money primitives (domain layer — pure, no framework or DB imports).
 *
 * All authoritative monetary math in checkout runs through exact decimal
 * arithmetic here and lands on integer minor units. JavaScript floating
 * point (`Number(price) * 100`, `x * pct / 100`) is never used for money:
 * binary floats cannot represent most decimal fractions, so repeated
 * percentage math drifts by whole minor units at volume.
 *
 * Rounding policy (approved default, documented in docs/checkout.md):
 * ROUND_HALF_UP applied exactly once per computed aggregate — per-unit
 * promotion prices, coupon discount, tax amount. Line totals and subtotals
 * are exact sums of already-rounded minor-unit integers.
 */

// ---------------------------------------------------------------------------
// Currency configuration
// ---------------------------------------------------------------------------

/** Supported settlement currencies and their minor-unit exponents. */
export const CURRENCIES = {
  USD: { minorUnits: 2 },
} as const;

export type SupportedCurrency = keyof typeof CURRENCIES;

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return typeof value === "string" && value in CURRENCIES;
}

/** Reject anything outside the supported set — never assume 2 decimals. */
export function assertSupportedCurrency(currency: string): asserts currency is SupportedCurrency {
  if (!isSupportedCurrency(currency)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
}

/** Largest minor-unit value that survives exact JS integer math downstream. */
export const MAX_MINOR_UNITS = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// Conversion (exact)
// ---------------------------------------------------------------------------

function toDecimalAmount(amount: string | number | Decimal, label: string): Decimal {
  let value: Decimal;
  try {
    value = amount instanceof Decimal ? amount : new Decimal(amount);
  } catch {
    throw new Error(`Invalid monetary amount (${label}).`);
  }
  if (!value.isFinite()) {
    throw new Error(`Invalid monetary amount (${label}).`);
  }
  return value;
}

/**
 * Major-unit decimal string/number → integer minor units, rounded half-up.
 * Rejects NaN/Infinity/unsafe results. Large values pass through Decimal
 * exactly — never through unsafe `Number` multiplication.
 */
export function toMinorUnits(
  amount: string | number | Decimal,
  currency: string = "USD",
): number {
  assertSupportedCurrency(currency);
  const { minorUnits } = CURRENCIES[currency];
  const minor = toDecimalAmount(amount, "amount")
    .mul(new Decimal(10).pow(minorUnits))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (!minor.isFinite()) {
    throw new Error("Monetary amount is not finite.");
  }
  const result = minor.toNumber();
  if (!Number.isSafeInteger(result)) {
    throw new Error("Monetary amount overflows safe integer range.");
  }
  return result;
}

/** Integer minor units → exact major-unit storage string (`"58.49"`). */
export function fromMinorUnits(
  minor: number,
  currency: string = "USD",
): string {
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Minor-unit amount must be a safe integer.");
  }
  assertSupportedCurrency(currency);
  const { minorUnits } = CURRENCIES[currency];
  return new Decimal(minor).div(new Decimal(10).pow(minorUnits)).toFixed(minorUnits);
}

/** Display helper for server-computed minor-unit totals (exact, no float). */
export function formatMinorUnits(
  minor: number,
  currency: string = "USD",
): string {
  assertSupportedCurrency(currency);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${fromMinorUnits(minor, currency).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Guard for computed cent values crossing module boundaries. */
export function assertMinorUnits(value: number, label: string): asserts value is number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid minor-unit amount (${label}).`);
  }
}

export function assertNonNegativeMinorUnits(value: number, label: string): void {
  assertMinorUnits(value, label);
  if (value < 0) {
    throw new Error(`Monetary amount must not be negative (${label}).`);
  }
}

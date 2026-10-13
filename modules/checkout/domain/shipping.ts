import { UnsupportedDestinationError } from "./errors";

/**
 * Shipping catalog (domain layer — no framework or DB imports).
 *
 * Fees stay server-authoritative: only the method id crosses the boundary
 * and every charge is computed here. Client-submitted fees can never apply.
 *
 * Configuration status: NO approved carrier/region table exists, so the
 * default rules below serve every destination with flat fees (existing
 * behavior, now explicit and restrictable). Regions use ISO-3166 alpha-2
 * codes; `"*"` means worldwide. Narrowing a method to specific regions is a
 * configuration change — unsupported destinations then fail closed.
 *
 * Weight: the catalog carries no per-variant weight yet (see
 * `weight_grams`, nullable). Rules with `maxWeightGrams` are skipped while
 * weight is unknown rather than guessed — deterministic and documented.
 */

export const SHIPPING_METHODS = {
  STANDARD: {
    label: "Standard delivery",
    baseFeeCents: 499,
    etaDays: "3–5 business days",
  },
  EXPRESS: {
    label: "Express delivery",
    baseFeeCents: 1299,
    etaDays: "1–2 business days",
  },
} as const;

export type ShippingMethodId = keyof typeof SHIPPING_METHODS;

export interface ShippingRule {
  method: ShippingMethodId;
  /** `"*"` serves every destination; otherwise ISO alpha-2 allowlist. */
  regions: "*" | string[];
  /** Null = no weight limit. Limits apply only when weight is known. */
  maxWeightGrams: number | null;
  /** Whether this method's fee enters the taxable base where taxed. */
  taxable: boolean;
}

export const SHIPPING_RULES: ShippingRule[] = [
  { method: "STANDARD", regions: "*", maxWeightGrams: null, taxable: false },
  { method: "EXPRESS", regions: "*", maxWeightGrams: null, taxable: false },
];

/**
 * BR-018 minimum-order free shipping: a STANDARD shipment is free when the
 * discounted subtotal strictly exceeds the threshold. EXPRESS is never free.
 */
export const FREE_SHIPPING_THRESHOLD_CENTS = 7500;

export function isShippingMethod(value: unknown): value is ShippingMethodId {
  return (
    typeof value === "string" &&
    (value === "STANDARD" || value === "EXPRESS")
  );
}

/** Server-authoritative shipping charge in cents. */
export function calculateShippingCents(
  method: ShippingMethodId,
  subtotalAfterDiscountsCents: number,
): number {
  if (
    method === "STANDARD" &&
    subtotalAfterDiscountsCents > FREE_SHIPPING_THRESHOLD_CENTS
  ) {
    return 0;
  }
  return SHIPPING_METHODS[method].baseFeeCents;
}

export interface ShipmentWeightLine {
  weightGrams: number | null;
  quantity: number;
}

/**
 * Authoritative shipment weight in grams, or null when any line lacks
 * weight data. Null is a defined outcome (limits skipped), never an error.
 */
export function calculateShipmentWeightGrams(
  lines: ShipmentWeightLine[],
): number | null {
  let total = 0;
  for (const line of lines) {
    if (line.weightGrams === null || line.weightGrams === undefined) return null;
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new Error("Invalid shipment line quantity.");
    }
    total += line.weightGrams * line.quantity;
  }
  return total;
}

export interface ShippingQuote {
  method: ShippingMethodId;
  feeCents: number;
  /** Portion of the fee that enters the taxable base (0 unless taxed). */
  taxableCents: number;
}

export interface ShippingQuoteInput {  method: ShippingMethodId;
  country: string | null | undefined;
  subtotalAfterDiscountsCents: number;
  weightGrams: number | null;
  taxesShipping: boolean;
}

/**
 * Full server-side rate computation: destination eligibility, weight
 * limits (when weight is known), then the fee schedule. Throws
 * `UnsupportedDestinationError` for unserved destinations — callers map it
 * to a structured checkout error, never a silent fallback.
 *
 * The ruleset is a parameter so tests can exercise restricted regions and
 * weight limits without mutating the approved default configuration.
 */
export function quoteShippingWithRules(
  rules: ShippingRule[],
  input: ShippingQuoteInput,
): ShippingQuote {
  const rule = rules.find((r) => r.method === input.method);
  if (!rule) {
    throw new Error(`Unsupported shipping method: ${input.method}`);
  }
  const country = (input.country ?? "").trim().toUpperCase();
  if (rule.regions !== "*" && !rule.regions.includes(country)) {
    throw new UnsupportedDestinationError(country || "this destination");
  }
  if (
    rule.maxWeightGrams !== null &&
    input.weightGrams !== null &&
    input.weightGrams > rule.maxWeightGrams
  ) {
    throw new UnsupportedDestinationError(
      `Shipments over ${(rule.maxWeightGrams / 1000).toFixed(1)} kg need a custom quote`,
    );
  }
  const feeCents = calculateShippingCents(input.method, input.subtotalAfterDiscountsCents);
  return {
    method: input.method,
    feeCents,
    taxableCents: rule.taxable && input.taxesShipping ? feeCents : 0,
  };
}

export function quoteShipping(input: ShippingQuoteInput): ShippingQuote {
  return quoteShippingWithRules(SHIPPING_RULES, input);
}


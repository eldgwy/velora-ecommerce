import Decimal from "decimal.js";

/**
 * Product promotion rules (domain layer — pure, no framework or DB imports).
 *
 * Single authority for promotion math and overlap selection, used by the
 * cart, checkout, and storefront alike — no per-surface duplicates.
 *
 * Selection policy (BR-009 + overlap default): at most one product-level
 * promotion applies per unit. The winner is the lowest resulting unit
 * price; ties break by promotion id ascending (lexicographic), which is
 * stable across queries regardless of database row order. A promotion that
 * yields no saving does not apply (no badge without a lower price).
 */

export type PromotionKind = "PERCENTAGE" | "FIXED";

export interface PromotionCandidate {
  id: string;
  name: string;
  type: PromotionKind;
  value: string | number;
}

export interface PromotionSelection {
  id: string;
  name: string;
  type: PromotionKind;
  value: string;
  /** Saving per unit vs. the list price, minor units (> 0). */
  savingCents: number;
  /** Resulting unit price, minor units. */
  effectiveCents: number;
}

/**
 * Apply one promotion to a unit price (minor units, exact decimal).
 * Percentage rounds half-up once; fixed converts exactly. Never negative,
 * never above the list price. Invalid terms (unparseable, non-positive
 * percentage) yield no discount instead of throwing — eligibility
 * validation lives at the admin boundary and the checkout guard.
 */
export function applyPromotionToUnitPriceCents(
  listCents: number,
  promotion: { type: PromotionKind; value: string | number },
): number {
  if (!Number.isSafeInteger(listCents) || listCents < 0) return 0;
  if (promotion.type === "PERCENTAGE") {
    let pct: Decimal;
    try {
      pct = new Decimal(promotion.value);
    } catch {
      return listCents;
    }
    if (!pct.isFinite() || pct.lte(0)) return listCents;
    const effective = new Decimal(listCents)
      .mul(new Decimal(100).minus(pct))
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    if (!effective.isFinite()) return listCents;
    return Math.max(0, Math.min(effective.toNumber(), listCents));
  }
  let fixed: Decimal;
  try {
    fixed = new Decimal(promotion.value).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  } catch {
    return listCents;
  }
  if (!fixed.isFinite() || fixed.lte(0)) return listCents;
  return Math.max(0, listCents - fixed.toNumber());
}

/**
 * Deterministic winner among eligible candidates (already window/filtered
 * by the caller): lowest effective unit price, then lowest id. Returns
 * null when no candidate produces a positive saving.
 */
export function selectBestPromotion(
  listCents: number,
  candidates: PromotionCandidate[],
): PromotionSelection | null {
  let winner: PromotionSelection | null = null;
  for (const c of candidates) {
    const effectiveCents = applyPromotionToUnitPriceCents(listCents, {
      type: c.type,
      value: c.value,
    });
    const savingCents = listCents - effectiveCents;
    if (savingCents <= 0) continue;
    if (
      winner === null ||
      savingCents > winner.savingCents ||
      (savingCents === winner.savingCents && c.id < winner.id)
    ) {
      winner = {
        id: c.id,
        name: c.name,
        type: c.type,
        value: String(c.value),
        savingCents,
        effectiveCents,
      };
    }
  }
  return winner;
}

export interface PromotionWindow {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Window eligibility with one clock value; NULL endsAt is open-ended. */
export function isPromotionWindowEligible(promo: PromotionWindow, now: Date): boolean {
  if (!promo.isActive) return false;
  if (promo.startsAt !== null && promo.startsAt.getTime() > now.getTime()) return false;
  if (promo.endsAt !== null && promo.endsAt.getTime() < now.getTime()) return false;
  return true;
}

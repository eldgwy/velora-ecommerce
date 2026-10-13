/**
 * Tax jurisdiction configuration (domain layer — pure).
 *
 * There is no approved tax table in the repository, so the jurisdiction
 * list is intentionally EMPTY. `resolveTaxRule` then returns an explicit
 * zero-rate `UNCONFIGURED` rule instead of inventing a legal rate — the
 * checkout proceeds exactly as before (0.00 tax), but the snapshot and the
 * UI now record that no jurisdiction applied rather than implying one did.
 *
 * Enabling real tax is a configuration change, not a code change:
 *  1. Get approval for each (country → rate, shipping-taxability) row.
 *  2. Append rows to TAX_JURISDICTIONS below.
 *  3. Old orders keep their frozen `tax_jurisdiction`/`tax_rate_bps`
 *     snapshot and never reprice.
 */

export interface TaxJurisdictionRule {
  /** Stable snapshot id, e.g. `"US-CA-2026"`. */
  id: string;
  /** ISO-3166 alpha-2 country this rule applies to. */
  country: string;
  /** Tax rate in basis points (825 = 8.25%). Non-negative integer. */
  rateBps: number;
  /** Whether the shipping fee is part of the taxable base here. */
  taxesShipping: boolean;
}

export const TAX_JURISDICTIONS: TaxJurisdictionRule[] = [
  // Approved rows go here. Example shape (NOT active — illustrative only):
  // { id: "US-CA-2026", country: "US", rateBps: 825, taxesShipping: false },
];

export interface ResolvedTaxRule {
  jurisdiction: string;
  rateBps: number;
  taxesShipping: boolean;
  /** False when no approved rule matched — the zero-rate fallback. */
  configured: boolean;
}

export const UNCONFIGURED_TAX: ResolvedTaxRule = {
  jurisdiction: "UNCONFIGURED",
  rateBps: 0,
  taxesShipping: false,
  configured: false,
};

export function resolveTaxRule(country: string | null | undefined): ResolvedTaxRule {
  return resolveTaxRuleWithRules(TAX_JURISDICTIONS, country);
}

/** Injectable-rules variant for tests; production uses the approved table. */
export function resolveTaxRuleWithRules(
  rules: TaxJurisdictionRule[],
  country: string | null | undefined,
): ResolvedTaxRule {
  if (!country) return UNCONFIGURED_TAX;
  const normalized = country.trim().toUpperCase();
  const rule = rules.find((r) => r.country === normalized);
  if (!rule) return UNCONFIGURED_TAX;
  if (!Number.isSafeInteger(rule.rateBps) || rule.rateBps < 0) {
    throw new Error(`Invalid tax rate for jurisdiction ${rule.id}.`);
  }
  return {
    jurisdiction: rule.id,
    rateBps: rule.rateBps,
    taxesShipping: rule.taxesShipping,
    configured: true,
  };
}

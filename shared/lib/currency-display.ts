import Decimal from "decimal.js";

/**
 * Display-currency localization (T-5.5 foundation, decision D23).
 *
 * DELIBERATELY DISPLAY-ONLY. Checkout, payouts, refunds, invoices and
 * emails remain USD — the settlement currency lives in
 * `modules/checkout/domain/money.ts` (USD-pinned by design) and is NOT
 * touched here. Converting display prices requires operator-fed rates
 * (DISPLAY_CURRENCY_RATES env, e.g. "EUR=0.92,GBP=0.79"): with no rates
 * configured every price renders in USD and the selector UI is not shown,
 * so the feature is structurally OFF until an operator opts in. Rates are
 * static configuration — no automatic FX feeds, so staleness is an
 * operator ceremony (rotate the env + redeploy), never a silent drift.
 *
 * The exponent table is separate from the settlement `CURRENCIES` map on
 * purpose: the two evolve for different reasons (display locales vs. the
 * charging stack). Conversion amounts never flow into order snapshots.
 */

/** Currencies the storefront may convert DISPLAY prices into. */
export const DISPLAY_CURRENCY_EXPONENTS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  JPY: 0,
} as const;

export type DisplayCurrency = keyof typeof DISPLAY_CURRENCY_EXPONENTS;

/**
 * Parses DISPLAY_CURRENCY_RATES ("EUR=0.92,GBP=0.79") into validated
 * rates relative to USD. Unknown codes, non-positive/absurd rates and
 * malformed pairs are skipped, never fatal — a typo must not break the
 * storefront. USD converts to itself and is rejected as an entry.
 */
export function parseDisplayRatesEnv(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const code = part.slice(0, eq).trim().toUpperCase();
    const rateRaw = part.slice(eq + 1).trim();
    if (!/^[A-Z]{3}$/.test(code) || code === "USD") continue;
    if (!(code in DISPLAY_CURRENCY_EXPONENTS)) continue;
    try {
      const rate = new Decimal(rateRaw);
      if (!rate.isFinite() || rate.lte(0) || rate.gt(10_000)) continue;
      out[code] = rate.toNumber();
    } catch {
      continue;
    }
  }
  return out;
}

/** The cookie the storefront carries the display preference in. */
export const DISPLAY_CURRENCY_COOKIE = "velora_display_currency";

/**
 * Resolves the display currency for a request: the cookie value when it is
 * an AUDITED conversion target with a configured rate, else USD. A cookie
 * naming a currency without a configured rate can never smuggle stray
 * conversion into the UI — the price silently renders in USD instead.
 */
export function resolveDisplayCurrency(
  cookieValue: string | undefined | null,
  rates: Record<string, number>,
): string {
  if (!cookieValue) return "USD";
  const code = cookieValue.trim().toUpperCase();
  if (code === "USD") return "USD";
  return rateFor(code, rates) !== null ? code : "USD";
}

/** Deepest rate lookup: USD → USD uses the identity rate. */
export function rateFor(currency: string, rates: Record<string, number>): number | null {
  if (!(currency in DISPLAY_CURRENCY_EXPONENTS)) return null;
  if (currency === "USD") return 1;
  return rates[currency] ?? null;
}

/**
 * Exact USD major-unit amount → display-currency formatted string via
 * Decimal (ROUND_HALF_UP at the display exponent — the shared money
 * rounding policy). Returns the USD formatting unchanged when the target
 * has no configured rate: displaying a converted price without a known
 * rate would fabricate a figure.
 */
export function formatUsdInDisplayCurrency(
  amountUsd: string | number,
  currency: string,
  rates: Record<string, number>,
): string {
  const rate = rateFor(currency, rates);
  const exponent = DISPLAY_CURRENCY_EXPONENTS[currency as DisplayCurrency] ?? 2;
  if (rate === null) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      Number(amountUsd),
    );
  }
  const converted = new Decimal(amountUsd).mul(rate).toDecimalPlaces(exponent, Decimal.ROUND_HALF_UP);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(converted.toNumber());
}

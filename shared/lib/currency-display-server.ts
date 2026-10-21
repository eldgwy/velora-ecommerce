import "server-only";

import { cookies } from "next/headers";

import { DISPLAY_CURRENCY_COOKIE, parseDisplayRatesEnv, resolveDisplayCurrency } from "./currency-display";

/**
 * Server-side display-currency resolution for storefront surfaces (T-5.5,
 * D23): the preference cookie is read per request and validated against
 * the operator's configured rate table. Rates are configured per
 * deployment — with no DISPLAY_CURRENCY_RATES set this ALWAYS returns
 * "USD" and every price renders unchanged.
 */
export function getDisplayCurrencyRates(): Record<string, number> {
  return parseDisplayRatesEnv(process.env.DISPLAY_CURRENCY_RATES);
}

export async function getDisplayCurrency(): Promise<string> {
  const store = await cookies();
  return resolveDisplayCurrency(store.get(DISPLAY_CURRENCY_COOKIE)?.value, getDisplayCurrencyRates());
}

/** Serializable card-display bundle for one request (null = USD-only). */
export async function buildDisplayCurrencyProps(): Promise<{
  currency: string;
  rates: Record<string, number>;
} | null> {
  const rates = getDisplayCurrencyRates();
  if (Object.keys(rates).length === 0) return null;
  return { currency: await getDisplayCurrency(), rates };
}

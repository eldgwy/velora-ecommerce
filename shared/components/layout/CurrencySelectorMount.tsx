import { CurrencySelector } from "@/shared/components/layout/CurrencySelector";
import { getDisplayCurrency, getDisplayCurrencyRates } from "@/shared/lib/currency-display-server";

/**
 * Server wrapper for the header's display-currency selector (T-5.5, D23).
 * Renders the selector only when the deployment configured conversion
 * rates — otherwise nothing (USD-only, feature structurally off).
 */
export async function CurrencySelectorMount() {
  const rates = getDisplayCurrencyRates();
  if (Object.keys(rates).length === 0) return null;
  const current = await getDisplayCurrency();
  return <CurrencySelector availableCodes={Object.keys(rates)} current={current} />;
}

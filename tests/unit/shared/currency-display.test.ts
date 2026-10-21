import { describe, it, expect } from "vitest";

import {
  DISPLAY_CURRENCY_EXPONENTS,
  formatUsdInDisplayCurrency,
  parseDisplayRatesEnv,
  rateFor,
  resolveDisplayCurrency,
} from "@/shared/lib/currency-display";

describe("display currency rates parsing (T-5.5)", () => {
  it("parses a comma-separated operator rate list", () => {
    const rates = parseDisplayRatesEnv("EUR=0.92,GBP=0.79");
    expect(rates).toEqual({ EUR: 0.92, GBP: 0.79 });
  });

  it("rejects malformed, non-positive, absurd and unknown entries", () => {
    expect(
      parseDisplayRatesEnv("EUR=0,GBP=-1,JPY=99999999,XYZ=0.5,eurx=1,EUR=abc,,"),
    ).toEqual({});
    // USD is the base — never an entry.
    expect(parseDisplayRatesEnv("USD=1")).toEqual({});
  });

  it("treats an unset env as the feature being off", () => {
    expect(parseDisplayRatesEnv(undefined)).toEqual({});
    expect(parseDisplayRatesEnv("")).toEqual({});
  });

  it("supports lowercase env codes", () => {
    expect(parseDisplayRatesEnv("eur=0.92")).toEqual({ EUR: 0.92 });
  });
});

describe("display currency resolution", () => {
  const rates = { EUR: 0.9 };

  it("resolves the cookie when the code has a configured rate", () => {
    expect(resolveDisplayCurrency("eur", rates)).toBe("EUR");
    expect(resolveDisplayCurrency(" EUR ", rates)).toBe("EUR");
    expect(resolveDisplayCurrency("USD", rates)).toBe("USD");
  });

  it("falls back to USD for unconfigured or unknown cookies", () => {
    expect(resolveDisplayCurrency("GBP", rates)).toBe("USD");
    expect(resolveDisplayCurrency("DROP TABLE", rates)).toBe("USD");
    expect(resolveDisplayCurrency(null, rates)).toBe("USD");
  });
});

describe("rate lookup", () => {
  it("identity for USD, null for unconfigured", () => {
    expect(rateFor("USD", {})).toBe(1);
    expect(rateFor("EUR", { EUR: 0.9 })).toBe(0.9);
    expect(rateFor("EUR", {})).toBeNull();
    expect(rateFor("XYZ", { XYZ: 0.5 })).toBeNull(); // not a display currency at all
  });
});

describe("display conversion", () => {
  it("converts USD majors exactly, rounded half-up at the display exponent", () => {
    const rates = { EUR: 0.92 };
    expect(formatUsdInDisplayCurrency("10", "EUR", rates)).toBe("€9.20");
    expect(formatUsdInDisplayCurrency("19.99", "EUR", rates)).toBe("€18.39"); // 18.3908 → 18.39
    expect(formatUsdInDisplayCurrency("0.005", "EUR", rates)).toBe("€0.00");
  });

  it("handles a zero-decimal display currency", () => {
    const rates = { JPY: 155 };
    expect(formatUsdInDisplayCurrency("12.5", "JPY", rates)).toBe("¥1,938"); // 1937.5 → 1938
    expect(DISPLAY_CURRENCY_EXPONENTS.JPY).toBe(0);
  });

  it("never converts without a configured rate (no fabricated figures)", () => {
    expect(formatUsdInDisplayCurrency("10", "EUR", {})).toBe("$10.00");
    expect(formatUsdInDisplayCurrency(19.99, "CHF", {})).toBe("$19.99");
  });
});

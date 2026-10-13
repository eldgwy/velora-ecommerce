import { describe, it, expect } from "vitest";

import {
  MAX_MINOR_UNITS,
  assertNonNegativeMinorUnits,
  assertSupportedCurrency,
  formatMinorUnits,
  fromMinorUnits,
  isSupportedCurrency,
  toMinorUnits,
} from "@/modules/checkout/domain/money";

describe("currency configuration", () => {
  it("supports USD and rejects everything else", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("EUR")).toBe(false);
    expect(isSupportedCurrency("JPY")).toBe(false);
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
    expect(() => assertSupportedCurrency("EUR")).toThrow(/Unsupported currency/);
  });
});

describe("exact minor-unit conversion", () => {
  it("converts decimal strings without float drift", () => {
    expect(toMinorUnits("0.1")).toBe(10);
    expect(toMinorUnits("19.99")).toBe(1999);
    expect(toMinorUnits("0.07")).toBe(7);
    // 0.1 + 0.2 territory: exact where floats are not.
    expect(toMinorUnits("0.3")).toBe(30);
  });

  it("rounds half-up at the minor-unit boundary", () => {
    expect(toMinorUnits("19.995")).toBe(2000);
    expect(toMinorUnits("19.994")).toBe(1999);
  });

  it("rejects non-finite and unsafe amounts", () => {
    expect(() => toMinorUnits("abc")).toThrow(/Invalid monetary amount/);
    expect(() => toMinorUnits(Number.NaN)).toThrow();
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => toMinorUnits("99999999999999999999.99")).toThrow(/overflow/);
  });

  it("round-trips storage strings exactly", () => {
    expect(fromMinorUnits(1999)).toBe("19.99");
    expect(fromMinorUnits(0)).toBe("0.00");
    expect(fromMinorUnits(5)).toBe("0.05");
    expect(() => fromMinorUnits(1.5)).toThrow();
    expect(() => fromMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("formats display strings without float division", () => {
    expect(formatMinorUnits(5849)).toBe("$58.49");
    expect(formatMinorUnits(123456)).toBe("$1,234.56");
  });

  it("guards minor-unit inputs", () => {
    expect(() => assertNonNegativeMinorUnits(-1, "x")).toThrow(/negative/);
    expect(() => assertNonNegativeMinorUnits(Number.MAX_SAFE_INTEGER, "x")).not.toThrow();
    void MAX_MINOR_UNITS;
  });
});

import { describe, it, expect } from "vitest";

import {
  calculateShipmentWeightGrams,
  quoteShippingWithRules,
  type ShippingRule,
} from "@/modules/checkout/domain/shipping";
import {
  resolveTaxRuleWithRules,
  UNCONFIGURED_TAX,
} from "@/modules/checkout/domain/tax";
import { UnsupportedDestinationError } from "@/modules/checkout/domain/errors";

const OPEN_RULES: ShippingRule[] = [
  { method: "STANDARD", regions: "*", maxWeightGrams: null, taxable: false },
  { method: "EXPRESS", regions: "*", maxWeightGrams: null, taxable: false },
];

const RESTRICTED: ShippingRule[] = [
  { method: "STANDARD", regions: ["US", "CA"], maxWeightGrams: 5000, taxable: true },
  { method: "EXPRESS", regions: ["US"], maxWeightGrams: null, taxable: false },
];

describe("shipment weight", () => {
  it("sums authoritative per-line weights", () => {
    expect(
      calculateShipmentWeightGrams([
        { weightGrams: 250, quantity: 2 },
        { weightGrams: 100, quantity: 1 },
      ]),
    ).toBe(600);
  });

  it("returns null deterministically when any weight is unknown", () => {
    expect(
      calculateShipmentWeightGrams([
        { weightGrams: 250, quantity: 2 },
        { weightGrams: null, quantity: 1 },
      ]),
    ).toBeNull();
  });

  it("rejects invalid quantities", () => {
    expect(() =>
      calculateShipmentWeightGrams([{ weightGrams: 10, quantity: -1 }]),
    ).toThrow();
  });

  it("rejects negative weights and overflowing totals", () => {
    expect(() =>
      calculateShipmentWeightGrams([{ weightGrams: -5, quantity: 1 }]),
    ).toThrow(/weight/);
    expect(() =>
      calculateShipmentWeightGrams([
        { weightGrams: Number.MAX_SAFE_INTEGER, quantity: 2 },
      ]),
    ).toThrow(/overflow/);
  });
});

describe("destination and weight rules", () => {
  const base = {
    method: "STANDARD" as const,
    country: "US",
    subtotalAfterDiscountsCents: 1000,
    weightGrams: null as number | null,
    taxesShipping: false,
  };

  it("serves worldwide rules for any destination", () => {
    expect(quoteShippingWithRules(OPEN_RULES, { ...base, country: "JP" }).feeCents).toBe(499);
  });

  it("rejects unserved destinations without fallback", () => {
    expect(() =>
      quoteShippingWithRules(RESTRICTED, { ...base, country: "DE" }),
    ).toThrow(UnsupportedDestinationError);
    expect(
      quoteShippingWithRules(RESTRICTED, { ...base, country: "CA" }).feeCents,
    ).toBe(499);
  });

  it("enforces weight limits only when weight is known", () => {
    // Unknown weight skips the 5 kg limit deterministically.
    expect(
      quoteShippingWithRules(RESTRICTED, { ...base, weightGrams: null }).feeCents,
    ).toBe(499);
    expect(() =>
      quoteShippingWithRules(RESTRICTED, { ...base, weightGrams: 6000 }),
    ).toThrow(UnsupportedDestinationError);
    expect(
      quoteShippingWithRules(RESTRICTED, { ...base, weightGrams: 4999 }).feeCents,
    ).toBe(499);
  });

  it("marks taxable shipping only when rule and jurisdiction agree", () => {
    expect(
      quoteShippingWithRules(RESTRICTED, { ...base, taxesShipping: true }).taxableCents,
    ).toBe(499);
    expect(
      quoteShippingWithRules(RESTRICTED, { ...base, taxesShipping: false }).taxableCents,
    ).toBe(0);
    expect(
      quoteShippingWithRules(OPEN_RULES, { ...base, taxesShipping: true }).taxableCents,
    ).toBe(0);
  });
});

describe("tax jurisdiction resolution", () => {
  const rules = [
    { id: "US-CA-2026", country: "US", rateBps: 825, taxesShipping: false },
  ];

  it("resolves approved rules and flags them configured", () => {
    expect(resolveTaxRuleWithRules(rules, "us")).toEqual({
      jurisdiction: "US-CA-2026",
      rateBps: 825,
      taxesShipping: false,
      configured: true,
    });
  });

  it("falls back to explicit UNCONFIGURED for unknown destinations", () => {
    expect(resolveTaxRuleWithRules(rules, "DE")).toEqual(UNCONFIGURED_TAX);
    expect(resolveTaxRuleWithRules(rules, null)).toEqual(UNCONFIGURED_TAX);
    expect(resolveTaxRuleWithRules([], "US")).toEqual(UNCONFIGURED_TAX);
  });

  it("rejects invalid configured rates instead of charging them", () => {
    expect(() =>
      resolveTaxRuleWithRules([{ id: "X", country: "US", rateBps: -5, taxesShipping: false }], "US"),
    ).toThrow(/Invalid tax rate/);
  });
});

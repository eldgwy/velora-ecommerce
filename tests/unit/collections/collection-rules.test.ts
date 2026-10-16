import { describe, it, expect } from "vitest";

import {
  assertCollectionDescription,
  assertCollectionImage,
  assertCollectionName,
  normalizeCollectionSlug,
  slugifyCollectionName,
} from "@/modules/collections/domain/collection-rules";
import { CollectionValidationError } from "@/modules/collections/domain/collection-errors";

describe("slug normalization", () => {
  it("lowercases, trims, and collapses separators", () => {
    expect(normalizeCollectionSlug("  Summer Essentials ")).toBe("summer-essentials");
    expect(normalizeCollectionSlug("Editor's Picks!!")).toBe("editors-picks");
    expect(normalizeCollectionSlug("SALE__2026")).toBe("sale-2026");
    expect(slugifyCollectionName("Trending Now")).toBe("trending-now");
  });

  it("rejects illegal slugs", () => {
    expect(normalizeCollectionSlug("-abc-")).toBe("abc");
    for (const bad of ["", "  ", "ab", "x".repeat(65), "---", "!!!"]) {
      expect(() => normalizeCollectionSlug(bad)).toThrow(CollectionValidationError);
    }
  });
});

describe("field validation", () => {
  it("requires a bounded name", () => {
    expect(assertCollectionName("  Essentials  ")).toBe("Essentials");
    expect(() => assertCollectionName("")).toThrow(CollectionValidationError);
    expect(() => assertCollectionName("x".repeat(121))).toThrow(CollectionValidationError);
  });

  it("nulls blank descriptions and caps length", () => {
    expect(assertCollectionDescription(null)).toBeNull();
    expect(assertCollectionDescription("   ")).toBeNull();
    expect(() => assertCollectionDescription("x".repeat(2001))).toThrow(CollectionValidationError);
  });

  it("accepts HTTPS cover URLs only", () => {
    expect(assertCollectionImage(null)).toBeNull();
    expect(assertCollectionImage("")).toBeNull();
    expect(assertCollectionImage("https://cdn.example.com/c.jpg")).toBe(
      "https://cdn.example.com/c.jpg",
    );
    expect(() => assertCollectionImage("http://cdn.example.com/c.jpg")).toThrow(
      CollectionValidationError,
    );
    expect(() => assertCollectionImage("not-a-url")).toThrow(CollectionValidationError);
  });
});

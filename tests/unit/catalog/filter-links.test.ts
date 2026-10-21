import { describe, it, expect } from "vitest";

import { buildFilterHref } from "@/shared/lib/filter-links";

describe("buildFilterHref", () => {
  it("preserves untouched parameters", () => {
    const href = buildFilterHref(
      "/products",
      { brand: "aurum", minPrice: "10", rating: "4" },
      { category: "rings" },
    );
    expect(href).toBe("/products?brand=aurum&minPrice=10&rating=4&category=rings");
  });

  it("overrides patched parameters", () => {
    const href = buildFilterHref(
      "/search",
      { q: "silky", brand: "aurum" },
      { brand: "onyx" },
    );
    expect(href).toBe("/search?q=silky&brand=onyx");
  });

  it("drops a parameter when patched with undefined", () => {
    const href = buildFilterHref(
      "/products",
      { category: "rings", brand: "onyx" },
      { category: undefined },
    );
    expect(href).toBe("/products?brand=onyx");
  });

  it("resets pagination on filter change", () => {
    const href = buildFilterHref(
      "/products",
      { category: "rings", brand: "onyx", rating: "4", page: "5" },
      { category: "necklaces" },
    );
    expect(href).toBe("/products?category=necklaces&brand=onyx&rating=4");
    expect(href).not.toContain("page=");
  });

  it("keeps an explicitly patched page and removes it when patched off", () => {
    expect(
      buildFilterHref("/products", { brand: "a", page: "2" }, { page: "3" }),
    ).toBe("/products?brand=a&page=3");
    expect(
      buildFilterHref("/products", { brand: "a", page: "2" }, { page: undefined }),
    ).toBe("/products?brand=a");
  });

  it("returns the bare base path with nothing left to encode", () => {
    expect(buildFilterHref("/products", { q: "x" }, { q: undefined })).toBe("/products");
  });

  it("encodes special characters once", () => {
    const href = buildFilterHref("/search", {}, { q: "50% & a_b" });
    expect(href).toMatch(/^\/search\?q=/);
    const param = href.slice("/search?q=".length);
    expect(param).not.toContain("&&");
    expect(new URLSearchParams(href.split("?")[1]).get("q")).toBe("50% & a_b");
  });
});

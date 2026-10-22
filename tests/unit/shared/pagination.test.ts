import { describe, it, expect } from "vitest";

import { buildPageItems, parsePageParam } from "@/shared/components/ui/pagination";

describe("parsePageParam", () => {
  it("parses valid page numbers", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("7")).toBe(7);
    expect(parsePageParam(undefined)).toBe(1);
  });

  it("decodes invalid input to page 1", () => {
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-4")).toBe(1);
    expect(parsePageParam("1.5")).toBe(1);
    // parseInt stops at the first non-digit, so trailing junk is tolerated
    // the same way every previous admin page parsed query params.
    expect(parsePageParam("3xyz")).toBe(3);
  });

  it("clamps absurd page numbers to a bounded ceiling", () => {
    // A hand-crafted huge page must never become an absurd DB offset.
    expect(parsePageParam("99999999999999")).toBeLessThanOrEqual(100_000);
  });
});

describe("buildPageItems", () => {
  it("shows all pages for small counts", () => {
    expect(buildPageItems(1, 1)).toEqual([1]);
    expect(buildPageItems(2, 3)).toEqual([1, 2, 3]);
    expect(buildPageItems(5, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("always includes first, last, and the middle window", () => {
    expect(buildPageItems(5, 10)).toEqual([
      1, "start-ellipsis", 4, 5, 6, "end-ellipsis", 10,
    ]);
    // At the edges no ellipsis collapses onto the boundary page.
    expect(buildPageItems(1, 10)).toEqual([1, 2, "end-ellipsis", 10]);
    expect(buildPageItems(10, 10)).toEqual([1, "start-ellipsis", 9, 10]);
  });

  it("never emits more than 7 numbers plus 2 ellipses", () => {
    for (const total of [6, 7, 50, 9_999]) {
      for (let current = 1; current <= total; current += Math.max(1, Math.floor(total / 7))) {
        const items = buildPageItems(current, total);
        const numbers = items.filter((i): i is number => typeof i === "number");
        const ellipses = items.filter((i) => i === "start-ellipsis" || i === "end-ellipsis");
        expect(numbers.length).toBeLessThanOrEqual(7);
        expect(ellipses.length).toBeLessThanOrEqual(2);
        // Monotonically increasing numbers, no duplicates.
        const sorted = [...numbers].sort((a, b) => a - b);
        expect(numbers).toEqual(sorted);
        expect(numbers[0]).toBe(1);
        expect(numbers[numbers.length - 1]).toBe(total);
        expect(numbers).toContain(Math.min(current, total));
      }
    }
  });

  it("degrades gracefully for out-of-range requests", () => {
    expect(buildPageItems(999, 3)).toEqual([1, 2, 3]);
    expect(buildPageItems(0, 3)).toEqual([1, 2, 3]);
  });
});

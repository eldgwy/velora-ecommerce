"use client";

import type { ProductCardProduct, ProductCardPromotion } from "@/shared/components/product/ProductCard";
import { ProductSection } from "@/shared/components/home/ProductSection";
import type { CardDisplayCurrency } from "@/shared/components/product/ProductCard";

/**
 * Best sellers — real completed-sales rollup (falls back to top-rated when
 * the store has no completed sales yet; see services/home-sections.ts).
 * Legacy static featured carousel removed with the GP-02 fix.
 */
const BestSellers = ({
  products,
  savedIds,
  promotions,
}: {
  products: ProductCardProduct[];
  savedIds?: string[];
  promotions?: Record<string, ProductCardPromotion | null | undefined>;
  display?: CardDisplayCurrency | null;
}) => (
  <ProductSection
    eyebrow="Most Wanted"
    title="Best Sellers"
    description="Pieces our customers keep coming back to."
    viewAllHref="/products"
    products={products}
    savedIds={savedIds}
    promotions={promotions}
  />
);

export default BestSellers;

"use client";

import type { ProductCardProduct, ProductCardPromotion } from "@/shared/components/product/ProductCard";
import { ProductSection } from "@/shared/components/home/ProductSection";
import type { CardDisplayCurrency } from "@/shared/components/product/ProductCard";

/**
 * New arrivals — the `newest` listing sort, server-fetched. Legacy static
 * rail removed with the GP-02 fix.
 */
const NewArrivals = ({
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
    eyebrow="Just In"
    title="New Arrivals"
    viewAllHref="/products"
    products={products}
    savedIds={savedIds}
    promotions={promotions}
  />
);

export default NewArrivals;

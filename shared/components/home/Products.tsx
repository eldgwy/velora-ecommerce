"use client";

import type { ProductCardProduct, ProductCardPromotion } from "@/shared/components/product/ProductCard";
import { ProductSection } from "@/shared/components/home/ProductSection";
import type { CardDisplayCurrency } from "@/shared/components/product/ProductCard";/**
 * "Best Products" grid — backed by the deterministic default listing query
 * (server-fetched; see app/(storefront)/page.tsx). Legacy static list
 * removed with the GP-02 fix.
 */
const Products = ({
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
    eyebrow="Curated Selection"
    title="Best Products"
    viewAllHref="/products"
    products={products}
    savedIds={savedIds}
    promotions={promotions}
  />
);

export default Products;

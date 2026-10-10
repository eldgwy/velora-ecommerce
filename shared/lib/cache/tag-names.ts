/**
 * Cache tag constants for catalog domain.
 * Use these consistently across server actions and public queries.
 */
export const cacheTags = {
  // Categories
  categoriesTree: "categories:tree",
  category: (id: string) => `category:${id}`,

  // Brands
  brandsList: "brands:list",
  brand: (id: string) => `brand:${id}`,

  // Products
  productsListing: "products:listing",
  product: (id: string) => `product:${id}`,
  productBySlug: (slug: string) => `product:slug:${slug}`,

   // Variants
   variantsByProduct: (productId: string) => `variants:product:${productId}`,
   variant: (id: string) => `variant:${id}`,

   // Reviews
   reviewsByProduct: (productId: string) => `reviews:product:${productId}`,

   // Media
   imagesByProduct: (productId: string) => `images:product:${productId}`,
   image: (id: string) => `image:${id}`,
} as const;
"use server";

import { updateTag } from "next/cache";
import { cacheTags } from "./tag-names";

/**
 * Invalidate all catalog-related cache tags.
 * Use sparingly - prefer granular invalidation.
 */
export async function invalidateAllCatalogCache(): Promise<void> {
  updateTag(cacheTags.categoriesTree);
  updateTag(cacheTags.brandsList);
  updateTag(cacheTags.productsListing);
}

/**
 * Invalidate cache for a specific category and its effects.
 */
export async function invalidateCategoryCache(categoryId: string): Promise<void> {
  updateTag(cacheTags.categoriesTree);
  updateTag(cacheTags.category(categoryId));
  updateTag(cacheTags.productsListing);
}

/**
 * Invalidate cache for a specific brand.
 */
export async function invalidateBrandCache(brandId: string): Promise<void> {
  updateTag(cacheTags.brandsList);
  updateTag(cacheTags.brand(brandId));
  updateTag(cacheTags.productsListing);
}

/**
 * Invalidate cache for a specific product and its related data.
 */
export async function invalidateProductCache(productId: string, slug?: string): Promise<void> {
  updateTag(cacheTags.productsListing);
  updateTag(cacheTags.product(productId));
  if (slug) {
    updateTag(cacheTags.productBySlug(slug));
  }
  updateTag(cacheTags.variantsByProduct(productId));
  updateTag(cacheTags.imagesByProduct(productId));
}

/**
 * Invalidate cache for a specific variant.
 */
export async function invalidateVariantCache(variantId: string, productId: string): Promise<void> {
   updateTag(cacheTags.variantsByProduct(productId));
   updateTag(cacheTags.variant(variantId));
   updateTag(cacheTags.product(productId));
   updateTag(cacheTags.productsListing);
}

/**
 * Invalidate review lists and rating summaries for a product, plus the
 * product detail data and catalog listing that aggregate them.
 * Call after an approval/rejection changes public visibility or aggregates.
 */
export async function invalidateReviewCache(productId: string): Promise<void> {
   updateTag(cacheTags.reviewsByProduct(productId));
   updateTag(cacheTags.product(productId));
   updateTag(cacheTags.productsListing);
}

/**
 * Invalidate cache for product images.
 */
export async function invalidateImageCache(imageId: string, productId: string): Promise<void> {
  updateTag(cacheTags.imagesByProduct(productId));
  updateTag(cacheTags.image(imageId));
  updateTag(cacheTags.product(productId));
  updateTag(cacheTags.productsListing);
}

/**
 * Invalidate cart cache after a successful cart database commit.
 * Cart pages are dynamic (never trust cache for cart state), but tagged
 * fetches keyed by cart/owner still need invalidation on every mutation.
 */
export async function invalidateCartCache(options: {
  cartId?: string;
  userId?: string;
  guestId?: string;
}): Promise<void> {
  if (options.cartId) updateTag(cacheTags.cart(options.cartId));
  if (options.userId) updateTag(cacheTags.userCart(options.userId));
  if (options.guestId) updateTag(cacheTags.guestCart(options.guestId));
}
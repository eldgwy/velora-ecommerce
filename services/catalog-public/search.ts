import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import {
  categories,
  brands,
  products,
  productVariants,
  productImages,
} from "@/infrastructure/database/schema/catalog";
import { inventory } from "@/infrastructure/database/schema/inventory";
import { reviews } from "@/infrastructure/database/schema/reviews";
import { reviewStatusEnum } from "@/infrastructure/database/schema/enums";
import { unstable_cache } from "next/cache";
import { cacheTags } from "@/shared/lib/cache/tag-names";
import {
  getEffectiveVisibleCategoryIds,
  resolveCategorySlug,
  resolveBrandSlug,
} from "./queries";

// ============================================
// Types
// ============================================

export interface SearchFilters {
  query?: string;
  categorySlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  rating?: number; // minimum rating 1-5
  sort?: "price_asc" | "price_desc" | "newest" | "rating";
  page?: number;
  pageSize?: number;
}

export interface ProductSearchResult {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  comparePrice: string | null;
  primaryImage: {
    id: string;
    url: string;
    alt: string | null;
    isPrimary: boolean;
    sortOrder: number | null;
  } | null;
  minVariantPrice: string | null;
  brand: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
  averageRating: number | null;
  reviewCount: number;
}

export interface PaginatedSearchResult {
  items: ProductSearchResult[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

// ============================================
// Input Validation
// ============================================

function validateSearchInput(input: SearchFilters): SearchFilters {
  const validated: SearchFilters = {};

  // Validate query
  if (input.query !== undefined) {
    const trimmed = input.query.trim();
    validated.query = trimmed.length > 0 ? trimmed : undefined;
  }

  // Validate categorySlug (non-empty string; resolved to an ID by the query)
  if (input.categorySlug !== undefined) {
    const trimmed = input.categorySlug.trim();
    if (trimmed.length > 0) {
      validated.categorySlug = trimmed;
    }
  }

  // Validate brandSlug (non-empty string; resolved to an ID by the query)
  if (input.brandSlug !== undefined) {
    const trimmed = input.brandSlug.trim();
    if (trimmed.length > 0) {
      validated.brandSlug = trimmed;
    }
  }

  // Validate price range
  if (input.minPrice !== undefined) {
    const min = Number(input.minPrice);
    if (Number.isFinite(min) && min >= 0) {
      validated.minPrice = min;
    }
  }
  if (input.maxPrice !== undefined) {
    const max = Number(input.maxPrice);
    if (Number.isFinite(max) && max >= 0) {
      validated.maxPrice = max;
    }
  }
  // Normalize invalid range
  if (validated.minPrice !== undefined && validated.maxPrice !== undefined && validated.minPrice > validated.maxPrice) {
    [validated.minPrice, validated.maxPrice] = [validated.maxPrice, validated.minPrice];
  }

  // Validate inStockOnly
  if (input.inStockOnly !== undefined) {
    validated.inStockOnly = input.inStockOnly === true;
  }

  // Validate rating (1-5)
  if (input.rating !== undefined) {
    const rating = Number(input.rating);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      validated.rating = rating;
    }
  }

  // Validate sort
  const validSorts = ["price_asc", "price_desc", "newest", "rating"] as const;
  if (input.sort !== undefined && validSorts.includes(input.sort)) {
    validated.sort = input.sort;
  }

  // Validate pagination
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  validated.page = Math.max(1, Math.floor(Number(page) || 1));
  validated.pageSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 20)));

  return validated;
}

// ============================================
// Search Query Building
// ============================================

function escapeILike(value: string): string {
  return value
    .replace(/[%_\\]/g, (match) => `\\${match}`)
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

async function buildSearchConditions(filters: SearchFilters, visibleCategoryIds: string[]) {
  const conditions = [
    eq(products.status, "ACTIVE"),
    inArray(products.categoryId, visibleCategoryIds),
  ];

  // Full-text search across multiple fields
  if (filters.query) {
    const escaped = escapeILike(filters.query);
    const searchPattern = `%${escaped}%`;
    conditions.push(sql`
      (
        ${products.name} ILIKE ${searchPattern}
        OR ${products.description} ILIKE ${searchPattern}
        OR EXISTS (
          SELECT 1 FROM ${productVariants} pv
          WHERE pv.product_id = products.id
            AND pv.is_active = 'ACTIVE'
            AND pv.sku ILIKE ${searchPattern}
        )
        OR EXISTS (
          SELECT 1 FROM ${brands} b
          WHERE b.id = ${products.brandId}
            AND b.name ILIKE ${searchPattern}
        )
      )
    `);
  }

  if (filters.categorySlug) {
    const categoryId = await resolveCategorySlug(filters.categorySlug, visibleCategoryIds);
    if (categoryId === null) {
      return { conditions: null, visibleCategoryIds: [] };
    }
    conditions.push(eq(products.categoryId, categoryId));
  }

  if (filters.brandSlug) {
    const brandId = await resolveBrandSlug(filters.brandSlug);
    if (brandId === null) {
      return { conditions: null, visibleCategoryIds: [] };
    }
    conditions.push(eq(products.brandId, brandId));
  }

  return { conditions, visibleCategoryIds };
}

function getVariantPriceSubquery() {
  return sql`
    (
      SELECT MIN(COALESCE(pv.price_override, p.base_price))
      FROM ${productVariants} pv
      INNER JOIN ${products} p ON p.id = pv.product_id
      WHERE pv.product_id = products.id
        AND pv.is_active = 'ACTIVE'
    )
  `;
}

function getOrderByClause(sort: SearchFilters["sort"]) {
  const variantPriceSubquery = getVariantPriceSubquery();

  switch (sort) {
    case "price_asc":
      return sql`COALESCE(${variantPriceSubquery}, ${products.basePrice}) ASC, ${products.id} ASC`;
    case "price_desc":
      return sql`COALESCE(${variantPriceSubquery}, ${products.basePrice}) DESC, ${products.id} ASC`;
    case "newest":
      return sql`${products.createdAt} DESC, ${products.id} ASC`;
    case "rating":
      return sql`${getAvgRatingSubquery()} DESC NULLS LAST, ${products.id} ASC`;
    default:
      return sql`${products.createdAt} DESC, ${products.id} ASC`;
  }
}

function getAvgRatingSubquery() {
  return sql`
    (
      SELECT AVG(r.rating)::numeric(3,2)
      FROM ${reviews} r
         WHERE r.product_id = products.id
        AND r.status = ${reviewStatusEnum.enumValues[1]} -- APPROVED
        AND r.rating IS NOT NULL
    )
  `;
}

function getReviewCountSubquery() {
  return sql`
    (
      SELECT COUNT(*)
      FROM ${reviews} r
         WHERE r.product_id = products.id
        AND r.status = ${reviewStatusEnum.enumValues[1]} -- APPROVED
    )
  `;
}

// ============================================
// Public Search Function
// ============================================

/**
 * Search products with full-text search, filtering, sorting, and pagination.
 * Only returns ACTIVE products in effectively visible categories.
 */
export const searchProducts = unstable_cache(
  async (rawFilters: SearchFilters = {}): Promise<PaginatedSearchResult> => {
    const filters = validateSearchInput(rawFilters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    // Get effective visible category IDs
    const visibleCategoryIds = await getEffectiveVisibleCategoryIds();
    if (visibleCategoryIds.length === 0) {
      return { items: [], totalCount: 0, totalPages: 0, currentPage: page, pageSize };
    }

    const { conditions } = await buildSearchConditions(filters, visibleCategoryIds);
    if (!conditions) {
      return { items: [], totalCount: 0, totalPages: 0, currentPage: page, pageSize };
    }

    // Add price filters (against minimum active variant price)
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const variantPriceSubquery = getVariantPriceSubquery();
      if (filters.minPrice !== undefined) {
        conditions.push(sql`COALESCE(${variantPriceSubquery}, ${products.basePrice}) >= ${filters.minPrice}`);
      }
      if (filters.maxPrice !== undefined) {
        conditions.push(sql`COALESCE(${variantPriceSubquery}, ${products.basePrice}) <= ${filters.maxPrice}`);
      }
    }

    // Add inStock filter
    if (filters.inStockOnly) {
      conditions.push(sql`
        EXISTS (
          SELECT 1 FROM ${productVariants} pv
          INNER JOIN ${inventory} inv ON inv.variant_id = pv.id
          WHERE pv.product_id = products.id
            AND pv.is_active = 'ACTIVE'
            AND (inv.quantity - inv.reserved_quantity) > 0
        )
      `);
    }

    // Add rating filter
    if (filters.rating !== undefined) {
      conditions.push(sql`${getAvgRatingSubquery()} >= ${filters.rating}`);
    }

    // Fetch items
    const productRows = await db
      .select({
        id: products.id,
        name: products.name,
        basePrice: products.basePrice,
        comparePrice: products.comparePrice,
        categoryId: products.categoryId,
        brandId: products.brandId,
        minVariantPrice: getVariantPriceSubquery(),
        avgRating: getAvgRatingSubquery(),
        reviewCount: getReviewCountSubquery(),
      })
      .from(products)
      .where(and(...conditions))
      .orderBy(getOrderByClause(filters.sort))
      .limit(pageSize + 1)
      .offset(offset);

    const hasMore = productRows.length > pageSize;
    const items = hasMore ? productRows.slice(0, pageSize) : productRows;

    // Get primary images
    const productIds = items.map((p) => p.id);
    const images = productIds.length > 0
      ? await db
          .select()
          .from(productImages)
          .where(and(inArray(productImages.productId, productIds), eq(productImages.isPrimary, true)))
      : [];

    const imageMap = new Map(images.map((img) => [img.productId, img]));

    // Get brands and categories
    const brandIds = [...new Set(items.map((p) => p.brandId).filter(Boolean))];
    const categoryIds = [...new Set(items.map((p) => p.categoryId).filter(Boolean))];

    const [brandRows, categoryRows] = await Promise.all([
      brandIds.length > 0
        ? db.select({ id: brands.id, name: brands.name, slug: brands.slug }).from(brands).where(inArray(brands.id, brandIds))
        : [],
      categoryIds.length > 0
        ? db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories).where(inArray(categories.id, categoryIds))
        : [],
    ]);

    const brandMap = new Map(brandRows.map((b) => [b.id, b]));
    const categoryMap = new Map(categoryRows.map((c) => [c.id, c]));

    // Build results
    const results: ProductSearchResult[] = items.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.id, // Using ID as slug until products have slug column
      basePrice: p.basePrice,
      comparePrice: p.comparePrice,
      primaryImage: imageMap.get(p.id)
        ? {
            id: imageMap.get(p.id)!.id,
            url: imageMap.get(p.id)!.url,
            alt: imageMap.get(p.id)!.alt,
            isPrimary: imageMap.get(p.id)!.isPrimary,
            sortOrder: imageMap.get(p.id)!.sortOrder,
          }
        : null,
      minVariantPrice: (p.minVariantPrice ?? null) as string | null,
      brand: p.brandId && brandMap.has(p.brandId)
        ? { id: brandMap.get(p.brandId)!.id, name: brandMap.get(p.brandId)!.name, slug: brandMap.get(p.brandId)!.slug }
        : null,
      category: p.categoryId && categoryMap.has(p.categoryId)
        ? { id: categoryMap.get(p.categoryId)!.id, name: categoryMap.get(p.categoryId)!.name, slug: categoryMap.get(p.categoryId)!.slug }
        : null,
      averageRating: p.avgRating != null ? Number(p.avgRating) : null,
      reviewCount: Number(p.reviewCount ?? 0),
    }));

    // Get total count
    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(and(...conditions));

    return {
      items: results,
      totalCount: Number(totalCount),
      totalPages: Math.ceil(Number(totalCount) / pageSize),
      currentPage: page,
      pageSize,
    };
  },
  ["products-search"],
  { tags: [cacheTags.productsListing], revalidate: 60 }
);

// ============================================
// Search Suggestions (for autocomplete)
// ============================================

export interface SearchSuggestion {
  type: "product" | "category" | "brand";
  id: string;
  name: string;
  slug: string;
}

export const getSearchSuggestions = unstable_cache(
  async (query: string, limit: number = 5): Promise<SearchSuggestion[]> => {
    if (!query || query.trim().length < 2) return [];

    const trimmed = query.trim();
    const escaped = escapeILike(trimmed);
    const pattern = `%${escaped}%`;

    const visibleCategoryIds = await getEffectiveVisibleCategoryIds();
    if (visibleCategoryIds.length === 0) return [];

    const suggestions: SearchSuggestion[] = [];

    // Product suggestions
    const productResults = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(
        and(
          eq(products.status, "ACTIVE"),
          inArray(products.categoryId, visibleCategoryIds),
          sql`${products.name} ILIKE ${pattern}`
        )
      )
      .limit(limit);

    suggestions.push(...productResults.map((p) => ({
      type: "product" as const,
      id: p.id,
      name: p.name,
      slug: p.id,
    })));

    // Category suggestions
    const categoryResults = await db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .where(
        and(
          inArray(categories.id, visibleCategoryIds),
          sql`${categories.name} ILIKE ${pattern}`
        )
      )
      .limit(limit);

    suggestions.push(...categoryResults.map((c) => ({
      type: "category" as const,
      id: c.id,
      name: c.name,
      slug: c.slug,
    })));

    // Brand suggestions
    const brandResults = await db
      .select({ id: brands.id, name: brands.name, slug: brands.slug })
      .from(brands)
      .where(sql`${brands.name} ILIKE ${pattern}`)
      .limit(limit);

    suggestions.push(...brandResults.map((b) => ({
      type: "brand" as const,
      id: b.id,
      name: b.name,
      slug: b.slug,
    })));

    return suggestions.slice(0, limit);
  },
  ["search-suggestions"],
  { tags: [cacheTags.productsListing], revalidate: 300 }
);
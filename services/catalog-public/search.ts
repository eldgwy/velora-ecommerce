import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
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
import { escapeILike } from "@/shared/lib/like-patterns";
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



async function buildSearchConditions(
  filters: SearchFilters,
  visibleCategoryIds: string[],
) {
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

/**
 * Effective per-product price (min active-variant price, falling back to
 * the base price when a product has no listed variant). One SQL fragment
 * shared by the listing ORDER BY, the price filters, and the facets so the
 * three surfaces can never drift apart.
 */
function getEffectivePriceExpr() {
  return sql`COALESCE(${getVariantPriceSubquery()}, ${products.basePrice})`;
}

function getPriceRangeConditions(
  minPrice: number | undefined,
  maxPrice: number | undefined,
) {
  const conditions: SQL[] = [];
  const priceExpr = getEffectivePriceExpr();
  if (minPrice !== undefined) {
    conditions.push(sql`${priceExpr} >= ${minPrice}`);
  }
  if (maxPrice !== undefined) {
    conditions.push(sql`${priceExpr} <= ${maxPrice}`);
  }
  return conditions;
}

function getInStockCondition() {
  return sql`
    EXISTS (
      SELECT 1 FROM ${productVariants} pv
      INNER JOIN ${inventory} inv ON inv.variant_id = pv.id
      WHERE pv.product_id = products.id
        AND pv.is_active = 'ACTIVE'
        AND (inv.quantity - inv.reserved_quantity) > 0
    )
  `;
}

function getRatingCondition(rating: number) {
  return sql`${getAvgRatingSubquery()} >= ${rating}`;
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
    conditions.push(...getPriceRangeConditions(filters.minPrice, filters.maxPrice));

    // Add inStock filter
    if (filters.inStockOnly) {
      conditions.push(getInStockCondition());
    }

    // Add rating filter
    if (filters.rating !== undefined) {
      conditions.push(getRatingCondition(filters.rating));
    }

    // Fetch items
    const productRows = await db
      .select({
        id: products.id,
        slug: products.slug,
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
      slug: p.slug,
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
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(and(...conditions));
    const totalCount = countRow?.count ?? 0;

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
// Search Facets (T-5.3)
// ============================================

export interface SearchFacets {
  /** brand id → matching product count under every filter EXCEPT brand. */
  brandCounts: Record<string, number>;
  /** category id → matching product count under every filter EXCEPT category. */
  categoryCounts: Record<string, number>;
  /** Count per rating band (floor of the approved-review average), 1–5. */
  ratingBands: Array<{ rating: number; count: number }>;
  /** Min/max effective price under the query + selectors only. */
  priceBounds: { min: string | null; max: string | null };
  /** In-stock matches under every filter EXCEPT the in-stock checkbox. */
  inStockCount: number;
  /** Matches under every applied filter — consistent with searchProducts. */
  totalCount: number;
}

const emptyFacets: SearchFacets = {
  brandCounts: {},
  categoryCounts: {},
  ratingBands: [],
  priceBounds: { min: null, max: null },
  inStockCount: 0,
  totalCount: 0,
};

/**
 * Facet counts for the /search sidebar (T-5.3). Standard faceted-search
 * semantics: each dimension's counts are computed under all OTHER applied
 * filters minus that dimension's own selection, so a facet never zeroes
 * itself out. rating bands + price bounds + in-stock are computed under
 * the query + category + brand selectors only. Same visibility rules,
 * effective-price expression and rating subquery as searchProducts — one
 * shared source of truth. Cached under the productsListing tag so any
 * product/brand/category/review mutation invalidates facets with the
 * listing.
 */
async function getSearchFacetsImpl(
  rawFilters: SearchFilters = {},
): Promise<SearchFacets> {
  const filters = validateSearchInput(rawFilters);
  const visibleCategoryIds = await getEffectiveVisibleCategoryIds();
  if (visibleCategoryIds.length === 0) {
    return emptyFacets;
  }

  // Query + brand + category selector set (base for the numeric/boolean
  // facets and the band computation).
  const base = await buildSearchConditions(filters, visibleCategoryIds);
  if (!base.conditions) {
    return emptyFacets;
  }

  // Facet sets: each dimension's own selection is REMOVED from its filter
  // copy, while every other filter still applies, so a facet never zeroes
  // itself out.
  const [brandBase, categoryBase] = await Promise.all([
    buildSearchConditions({ ...filters, brandSlug: undefined }, visibleCategoryIds),
    buildSearchConditions({ ...filters, categorySlug: undefined }, visibleCategoryIds),
  ]);
  const dynamicConditions = [
    ...getPriceRangeConditions(filters.minPrice, filters.maxPrice),
    ...(filters.inStockOnly ? [getInStockCondition()] : []),
    ...(filters.rating !== undefined ? [getRatingCondition(filters.rating)] : []),
  ];
  if (!brandBase.conditions || !categoryBase.conditions) {
    return emptyFacets;
  }
  const brandSet = [...brandBase.conditions, ...dynamicConditions];
  const categorySet = [...categoryBase.conditions, ...dynamicConditions];
  // totalCount must be consistent with searchProducts for the same input:
  // every applied filter (including each dimension's selection).
  const allSet = [...base.conditions, ...dynamicConditions];

  const priceExpr = getEffectivePriceExpr();

  const [brandCountRows, categoryCountRows, ratingRows, miscRow, totalRow] = await Promise.all([
    db
      .select({ brandId: products.brandId, count: sql<number>`count(*)` })
      .from(products)
      .where(and(...brandSet, sql`${products.brandId} IS NOT NULL`))
      .groupBy(products.brandId),
    db
      .select({ categoryId: products.categoryId, count: sql<number>`count(*)` })
      .from(products)
      .where(and(...categorySet, sql`${products.categoryId} IS NOT NULL`))
      .groupBy(products.categoryId),
    // The rating subquery is correlated per product, so its band must be
    // computed in a derived table before grouping (GROUP BY may not contain
    // the correlated subquery itself).
    db.execute(sql`
      SELECT band AS rating, (count(*))::int AS count
      FROM (
        SELECT floor(${getAvgRatingSubquery()})::int AS band
        FROM ${products}
        WHERE ${and(...base.conditions)}
      ) AS rated
      WHERE band IS NOT NULL
      GROUP BY band
      ORDER BY band
    `),
    db
      .select({
        inStockCount: sql<number>`count(*) FILTER (WHERE ${getInStockCondition()})`,
        minPrice: sql<string | null>`min(${priceExpr})`,
        maxPrice: sql<string | null>`max(${priceExpr})`,
      })
      .from(products)
      .where(and(...base.conditions)),
    db
      .select({ totalCount: sql<number>`count(*)` })
      .from(products)
      .where(and(...allSet)),
  ]);

  const brandCounts: Record<string, number> = {};
  for (const row of brandCountRows) {
    if (row.brandId) brandCounts[row.brandId] = Number(row.count ?? 0);
  }
  const categoryCounts: Record<string, number> = {};
  for (const row of categoryCountRows) {
    if (row.categoryId) categoryCounts[row.categoryId] = Number(row.count ?? 0);
  }

  return {
    brandCounts,
    categoryCounts,
    ratingBands: ratingRows.map((r) => ({ rating: Number(r.rating), count: Number(r.count ?? 0) })),
    priceBounds: { min: miscRow[0]?.minPrice ?? null, max: miscRow[0]?.maxPrice ?? null },
    inStockCount: Number(miscRow[0]?.inStockCount ?? 0),
    totalCount: Number(totalRow[0]?.totalCount ?? 0),
  };
}

export const getSearchFacets = unstable_cache(
  getSearchFacetsImpl,
  ["products-search-facets"],
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
      .select({ id: products.id, slug: products.slug, name: products.name })
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
      slug: p.slug,
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
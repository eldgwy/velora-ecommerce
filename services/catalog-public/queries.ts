import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { db } from "@/infrastructure/database";
import {
  categories,
  brands,
  products,
  productVariants,
  productImages,
  productOptions,
  productOptionValues,
  variantOptionValues,
} from "@/infrastructure/database/schema/catalog";
import { inventory } from "@/infrastructure/database/schema/inventory";
import { reviews, reviewImages } from "@/infrastructure/database/schema/reviews";
import { reviewStatusEnum } from "@/infrastructure/database/schema/enums";
import { user } from "@/infrastructure/database/schema/auth";
import { unstable_cache } from "next/cache";
import { cacheTags } from "@/shared/lib/cache/tag-names";

// ============================================
// Types
// ============================================

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  children: PublicCategory[];
}

export interface PublicBrand {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
}

export interface PublicProductImage {
  id: string;
  url: string;
  alt: string | null;
  isPrimary: boolean;
  sortOrder: number | null;
}

export interface PublicProductVariant {
  id: string;
  sku: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVE";
  priceOverride: string | null;
  optionValues: Array<{
    optionId: string;
    optionName: string;
    valueId: string;
    value: string;
  }>;
  availableStock: number;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  basePrice: string;
  comparePrice: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVE";
  categoryId: string;
  brand: PublicBrand | null;
  images: PublicProductImage[];
  variants: PublicProductVariant[];
  options: Array<{
    id: string;
    name: string;
    values: Array<{ id: string; value: string }>;
  }>;
}

export interface PublicReview {
  id: string;
  rating: number | null;
  title: string | null;
  content: string | null;
  userName: string | null;
  createdAt: string;
}

export interface ProductReviewsResult {
  reviews: PublicReview[];
  averageRating: number | null;
  reviewCount: number;
}

export interface ProductListingItem {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  comparePrice: string | null;
  primaryImage: PublicProductImage | null;
  minVariantPrice: string | null;
  brand: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
}

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export interface ProductListingFilters {
  categorySlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  sort?: "price_asc" | "price_desc" | "newest" | "rating";
  page?: number;
  pageSize?: number;
}

// ============================================
// Category Queries
// ============================================

/**
 * Get the full category tree (admin) or effective-visible tree (storefront).
 * Uses recursive CTE for efficient tree traversal.
 */
export const getCategoryTree = unstable_cache(
  async (effectiveVisibleOnly: boolean = true): Promise<PublicCategory[]> => {
    if (effectiveVisibleOnly) {
      const visibleIds = await getEffectiveVisibleCategoryIds();
      if (visibleIds.length === 0) return [];

      const rows = await db
        .select()
        .from(categories)
        .where(inArray(categories.id, visibleIds));

      return buildCategoryTree(rows);
    }

    const rows = await db.select().from(categories);
    return buildCategoryTree(rows);
  },
  ["categories-tree"],
  { tags: [cacheTags.categoriesTree], revalidate: 3600 }
);

/**
 * Get effective visible category IDs (all ancestors active).
 */
export const getEffectiveVisibleCategoryIds = unstable_cache(
  async (): Promise<string[]> => {
    const result = await db.execute(sql`
      WITH RECURSIVE
        active_chain AS (
          SELECT c.id, c.parent_id, c.is_active
          FROM categories c
          WHERE c.parent_id IS NULL AND c.is_active = true

          UNION ALL

          SELECT c.id, c.parent_id, c.is_active
          FROM categories c
          INNER JOIN active_chain ac ON c.parent_id = ac.id
          WHERE c.is_active = true
        )
      SELECT id FROM active_chain
    `) as Array<{ id: string }>;

    return result.map((row) => row.id);
  },
  ["effective-visible-category-ids"],
  { tags: [cacheTags.categoriesTree], revalidate: 3600 }
);

/**
 * Get a category by slug (storefront).
 * Returns the category (if effectively visible) with its visible descendant
 * subtree built in a single pass — no per-child queries.
 */
export const getCategoryBySlug = unstable_cache(
  async (slug: string): Promise<PublicCategory | null> => {
    const [row] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug));

    if (!row) return null;

    const visibleIds = await getEffectiveVisibleCategoryIds();
    if (!visibleIds.includes(row.id)) return null;

    const visibleRows = await db
      .select()
      .from(categories)
      .where(inArray(categories.id, visibleIds));

    const tree = buildCategoryTree(visibleRows);
    return tree.find((node) => node.id === row.id) ?? toPublicCategory(row);
  },
  ["category-by-slug"],
  { tags: [cacheTags.categoriesTree], revalidate: 3600 }
);

/**
 * Resolve a category slug to its ID, but only when the category is effectively
 * visible (active chain from a root ancestor). Returns null for unknown or
 * effectively-invisible categories so the storefront never leaks hidden data.
 */
export async function resolveCategorySlug(
  slug: string,
  visibleCategoryIds: string[],
): Promise<string | null> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug));
  if (!row) return null;
  return visibleCategoryIds.includes(row.id) ? row.id : null;
}

/**
 * Resolve a brand slug to its ID. Brands have no active flag, so any existing
 * brand slug resolves.
 */
export async function resolveBrandSlug(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.slug, slug));
  return row ? row.id : null;
}

/**
 * Check if a category is effectively visible (the category and every ancestor
 * up to a root are active).
 */
async function isCategoryEffectiveVisible(categoryId: string): Promise<boolean> {
  const result = await db.execute(sql`
    WITH RECURSIVE
      ancestors AS (
        SELECT c.id, c.parent_id, c.is_active
        FROM categories c
        WHERE c.id = ${categoryId}

        UNION ALL

        SELECT p.id, p.parent_id, p.is_active
        FROM categories p
        INNER JOIN ancestors a ON p.id = a.parent_id
      )
    SELECT (bool_and(is_active)) AS exists
    FROM ancestors
  `) as Array<{ exists: boolean }>;

  return result[0]?.exists ?? false;
}

/**
 * Project a category row into its public-facing shape (no internal columns leaked).
 */
function toPublicCategory(row: typeof categories.$inferSelect): PublicCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    logo: row.logo,
    children: [],
  };
}

/**
 * Build category tree from flat list.
 */
function buildCategoryTree(rows: typeof categories.$inferSelect[]): PublicCategory[] {
  const map = new Map<string, PublicCategory>();
  const roots: PublicCategory[] = [];

  for (const row of rows) {
    map.set(row.id, toPublicCategory(row));
  }

  for (const row of rows) {
    const node = map.get(row.id)!;
    if (row.parentId && map.has(row.parentId)) {
      map.get(row.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ============================================
// Brand Queries
// ============================================

/**
 * Get all active brands (storefront).
 */
export const getActiveBrands = unstable_cache(
  async (): Promise<PublicBrand[]> => {
    const rows = await db
      .select({
        id: brands.id,
        slug: brands.slug,
        name: brands.name,
        description: brands.description,
        logo: brands.logo,
      })
      .from(brands)
      .orderBy(brands.name);

    return rows;
  },
  ["active-brands"],
  { tags: [cacheTags.brandsList], revalidate: 3600 }
);

/**
 * Get brand by slug (storefront).
 */
export const getBrandBySlug = unstable_cache(
  async (slug: string): Promise<PublicBrand | null> => {
    const [row] = await db
      .select({
        id: brands.id,
        slug: brands.slug,
        name: brands.name,
        description: brands.description,
        logo: brands.logo,
      })
      .from(brands)
      .where(eq(brands.slug, slug));

    return row ?? null;
  },
  ["brand-by-slug"],
  { tags: [cacheTags.brandsList], revalidate: 3600 }
);

// ============================================
// Product Queries
// ============================================

/**
 * Get paginated product listing (storefront).
 * Only returns ACTIVE products in effectively visible categories.
 */
export const listProducts = unstable_cache(
  async (filters: ProductListingFilters = {}): Promise<PaginatedResult<ProductListingItem>> => {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 20, 100);
    const offset = (page - 1) * pageSize;

    // Get effective visible category IDs
    const visibleCategoryIds = await getEffectiveVisibleCategoryIds();
    if (visibleCategoryIds.length === 0) {
      return { items: [], totalCount: 0, totalPages: 0, currentPage: page, pageSize };
    }

    // Build conditions
    const conditions = [
      eq(products.status, "ACTIVE"),
      inArray(products.categoryId, visibleCategoryIds),
    ];

    if (filters.categorySlug) {
      const categoryId = await resolveCategorySlug(filters.categorySlug, visibleCategoryIds);
      if (categoryId === null) {
        return { items: [], totalCount: 0, totalPages: 0, currentPage: page, pageSize };
      }
      conditions.push(eq(products.categoryId, categoryId));
    }

    if (filters.brandSlug) {
      const brandId = await resolveBrandSlug(filters.brandSlug);
      if (brandId === null) {
        return { items: [], totalCount: 0, totalPages: 0, currentPage: page, pageSize };
      }
      conditions.push(eq(products.brandId, brandId));
    }

    // Get products with joins
    const productRows = await db
      .select({
        id: products.id,
        name: products.name,
        basePrice: products.basePrice,
        comparePrice: products.comparePrice,
        categoryId: products.categoryId,
        brandId: products.brandId,
      })
      .from(products)
      .where(and(...conditions))
      .orderBy(getProductOrderBy(filters.sort))
      .limit(pageSize + 1)
      .offset(offset);

    const hasMore = productRows.length > pageSize;
    const items = hasMore ? productRows.slice(0, pageSize) : productRows;

    // Get primary images for all products
    const productIds = items.map((p) => p.id);
    const images = productIds.length > 0
      ? await db
          .select()
          .from(productImages)
          .where(and(inArray(productImages.productId, productIds), eq(productImages.isPrimary, true)))
      : [];

    const imageMap = new Map(images.map((img) => [img.productId, img]));

    // Get min variant price for each product
    const variantPrices = productIds.length > 0
      ? (await db.execute(sql`
          SELECT pv.product_id, MIN(COALESCE(pv.price_override, p.base_price)) as min_price
          FROM product_variant pv
          INNER JOIN products p ON p.id = pv.product_id
          WHERE pv.product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
            AND pv.is_active = 'ACTIVE'
          GROUP BY pv.product_id
        `)) as Array<{ product_id: string; min_price: string }>
      : [];

    const priceMap = new Map(variantPrices.map((vp) => [vp.product_id, vp.min_price]));

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

    // Build listing items
    const listingItems: ProductListingItem[] = items.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.id, // Use ID as slug since products don't have slug column yet
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
      minVariantPrice: priceMap.get(p.id) ?? null,
      brand: p.brandId && brandMap.has(p.brandId)
        ? { id: brandMap.get(p.brandId)!.id, name: brandMap.get(p.brandId)!.name, slug: brandMap.get(p.brandId)!.slug }
        : null,
      category: p.categoryId && categoryMap.has(p.categoryId)
        ? { id: categoryMap.get(p.categoryId)!.id, name: categoryMap.get(p.categoryId)!.name, slug: categoryMap.get(p.categoryId)!.slug }
        : null,
    }));

    // Get total count for pagination
    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(and(...conditions));

    return {
      items: listingItems,
      totalCount: Number(totalCount),
      totalPages: Math.ceil(Number(totalCount) / pageSize),
      currentPage: page,
      pageSize,
    };
  },
  ["products-listing"],
  { tags: [cacheTags.productsListing], revalidate: 60 }
);

/**
 * Get product detail by slug (storefront).
 * Returns full product with variants, options, images.
 * Note: Currently uses product ID as slug since products table doesn't have slug column yet.
 */
export const getProductBySlug = unstable_cache(
  async (id: string): Promise<PublicProduct | null> => {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.status, "ACTIVE")));

    if (!product) return null;

    // Check category effective visibility
    const isVisible = await isCategoryEffectiveVisible(product.categoryId);
    if (!isVisible) return null;

    // Fetch all related data in parallel
    const [brand, images, variants, options] = await Promise.all([
      getBrandById(product.brandId),
      getProductImages(product.id),
      getProductVariants(product.id),
      getProductOptions(product.id),
    ]);

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      slug: product.id, // Use ID as slug
      basePrice: product.basePrice,
      comparePrice: product.comparePrice,
      status: product.status,
      categoryId: product.categoryId,
      brand,
      images,
      variants,
      options,
    };
  },
  ["product-by-slug"],
  { tags: [cacheTags.productsListing], revalidate: 60 }
);

/**
 * Get product by ID (storefront) - for direct access.
 */
export const getProductById = unstable_cache(
  async (id: string): Promise<PublicProduct | null> => {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.status, "ACTIVE")));

    if (!product) return null;

    const isVisible = await isCategoryEffectiveVisible(product.categoryId);
    if (!isVisible) return null;

    const [brand, images, variants, options] = await Promise.all([
      getBrandById(product.brandId),
      getProductImages(product.id),
      getProductVariants(product.id),
      getProductOptions(product.id),
    ]);

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      slug: product.id, // Use ID as slug
      basePrice: product.basePrice,
      comparePrice: product.comparePrice,
      status: product.status,
      categoryId: product.categoryId,
      brand,
      images,
      variants,
      options,
    };
  },
  ["product-by-id"],
  { tags: [cacheTags.productsListing], revalidate: 60 }
);

// ============================================
// Helper Functions
// ============================================

async function getBrandById(brandId: string): Promise<PublicBrand | null> {
  const [row] = await db
    .select({
      id: brands.id,
      slug: brands.slug,
      name: brands.name,
      description: brands.description,
      logo: brands.logo,
    })
    .from(brands)
    .where(eq(brands.id, brandId));
  return row ?? null;
}

const getProductImages = unstable_cache(
  async (productId: string): Promise<PublicProductImage[]> => {
    const rows = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(
        sql`${productImages.sortOrder} ASC NULLS LAST`,
        productImages.createdAt,
      );

    return rows.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      isPrimary: img.isPrimary,
      sortOrder: img.sortOrder,
    }));
  },
  ["product-images"],
  { tags: [cacheTags.productsListing], revalidate: 3600 }
);

const getProductVariants = unstable_cache(
  async (productId: string): Promise<PublicProductVariant[]> => {
    const variantRows = await db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, productId), eq(productVariants.status, "ACTIVE")));

    if (variantRows.length === 0) return [];

    // Get option values for all variants
    const variantIds = variantRows.map((v) => v.id);
    const variantOptions = await db.execute(sql`
      SELECT vov.variant_id, pov.id as option_value_id, pov.value, po.id as option_id, po.name as option_name
      FROM variant_option_value vov
      INNER JOIN product_option_value pov ON pov.id = vov.option_value_id
      INNER JOIN product_option po ON po.id = pov.option_id
      WHERE vov.variant_id IN (${sql.join(variantIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY po.sort_order, pov.sort_order
    `) as Array<{
      variant_id: string;
      option_value_id: string;
      value: string;
      option_id: string;
      option_name: string;
    }>;

    // Get inventory for all variants
    const inventoryRows = variantIds.length > 0
      ? await db
          .select({ variantId: inventory.variantId, quantity: inventory.quantity, reservedQuantity: inventory.reservedQuantity })
          .from(inventory)
          .where(inArray(inventory.variantId, variantIds))
      : [];

    const inventoryMap = new Map(inventoryRows.map((inv) => [inv.variantId, inv]));

    // Group option values by variant
    const optionsByVariant = new Map<string, PublicProductVariant["optionValues"]>();
    for (const vo of variantOptions) {
      if (!optionsByVariant.has(vo.variant_id)) {
        optionsByVariant.set(vo.variant_id, []);
      }
      optionsByVariant.get(vo.variant_id)!.push({
        optionId: vo.option_id,
        optionName: vo.option_name,
        valueId: vo.option_value_id,
        value: vo.value,
      });
    }

    return variantRows.map((v) => {
      const inv = inventoryMap.get(v.id);
      const availableStock = inv ? inv.quantity - inv.reservedQuantity : 0;
      return {
        id: v.id,
        sku: v.sku,
        status: v.status as "DRAFT" | "ACTIVE" | "ARCHIVE",
        priceOverride: v.priceOverride,
        optionValues: optionsByVariant.get(v.id) ?? [],
        availableStock: Math.max(0, availableStock),
      };
    });
  },
  ["product-variants"],
  { tags: [cacheTags.productsListing], revalidate: 3600 }
);

const getProductOptions = unstable_cache(
  async (productId: string) => {
    const optionRows = await db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, productId))
      .orderBy(productOptions.sortOrder);

    if (optionRows.length === 0) return [];

    const optionIds = optionRows.map((o) => o.id);
    const valueRows = await db
      .select()
      .from(productOptionValues)
      .where(inArray(productOptionValues.optionId, optionIds))
      .orderBy(productOptionValues.sortOrder);

    const valuesByOption = new Map<string, Array<{ id: string; value: string }>>();
    for (const val of valueRows) {
      if (!valuesByOption.has(val.optionId)) {
        valuesByOption.set(val.optionId, []);
      }
      valuesByOption.get(val.optionId)!.push({ id: val.id, value: val.value });
    }

    return optionRows.map((o) => ({
      id: o.id,
      name: o.name,
      values: valuesByOption.get(o.id) ?? [],
    }));
  },
  ["product-options"],
  { tags: [cacheTags.productsListing], revalidate: 3600 }
);

function getProductOrderBy(sort?: ProductListingFilters["sort"]) {
  switch (sort) {
    case "price_asc":
      return sql`COALESCE((
        SELECT MIN(COALESCE(pv.price_override, p.base_price))
        FROM product_variant pv
        INNER JOIN products p ON p.id = pv.product_id
        WHERE pv.product_id = products.id AND pv.is_active = 'ACTIVE'
      ), products.base_price) ASC`;
    case "price_desc":
      return sql`COALESCE((
        SELECT MIN(COALESCE(pv.price_override, p.base_price))
        FROM product_variant pv
        INNER JOIN products p ON p.id = pv.product_id
        WHERE pv.product_id = products.id AND pv.is_active = 'ACTIVE'
      ), products.base_price) DESC`;
    case "newest":
      return products.createdAt;
    case "rating":
      return sql`(
        SELECT AVG(r.rating)::numeric(3,2)
        FROM ${reviews} r
        WHERE r.product_id = products.id
          AND r.status = ${reviewStatusEnum.enumValues[1]}
          AND r.rating IS NOT NULL
      ) DESC NULLS LAST`;
    default:
      return products.createdAt;
  }
}

/**
 * Get approved reviews for a product with rating summary.
 */
export const getProductReviews = unstable_cache(
  async (productId: string): Promise<ProductReviewsResult> => {
    // Get approved reviews with user info
    const reviewRows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        title: reviews.title,
        content: reviews.content,
        createdAt: reviews.createdAt,
        userName: user.name,
      })
      .from(reviews)
      .leftJoin(user, eq(reviews.userId, user.id))
      .where(
        and(
          eq(reviews.productId, productId),
          eq(reviews.status, reviewStatusEnum.enumValues[1]) // APPROVED
        )
      )
      .orderBy(desc(reviews.createdAt));

    const reviewsData: PublicReview[] = reviewRows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      content: r.content,
      userName: r.userName,
      createdAt: r.createdAt.toISOString(),
    }));

    // Calculate average rating and count
    const ratingRows = await db
      .select({
        avgRating: sql<number>`AVG(${reviews.rating})::numeric(3,2)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.productId, productId),
          eq(reviews.status, reviewStatusEnum.enumValues[1]),
          sql`${reviews.rating} IS NOT NULL`
        )
      );

    const avgRating = ratingRows[0]?.avgRating ?? null;
    const reviewCount = Number(ratingRows[0]?.count ?? 0);

    return {
      reviews: reviewsData,
      averageRating: avgRating != null ? Number(avgRating) : null,
      reviewCount,
    };
  },
   ["product-reviews"],
   { tags: [cacheTags.productsListing], revalidate: 300 }
 );
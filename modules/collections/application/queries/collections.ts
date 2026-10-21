import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import {
  productImages,
  products,
  productVariants,
} from "@/infrastructure/database/schema/catalog";
import {
  collectionProducts,
  collections,
} from "@/infrastructure/database/schema/marketing";

export interface CollectionListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  isActive: boolean;
  sortOrder: number | null;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionList {
  items: CollectionListItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/** Admin collection list: searchable, paginated, with product counts. */
export async function listCollections(opts: {
  query?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<CollectionList> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const conditions = [];
  if (opts.query && opts.query.trim() !== "") {
    conditions.push(ilike(collections.name, `%${opts.query.trim()}%`));
  }
  if (opts.isActive !== undefined) {
    conditions.push(eq(collections.isActive, opts.isActive));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(collections)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select()
    .from(collections)
    .where(where)
    .orderBy(asc(collections.sortOrder), desc(collections.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const counts =
    rows.length > 0
      ? ((await db.execute(sql`
          SELECT collection_id, COUNT(*)::int AS count
          FROM collection_products
          WHERE collection_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
          GROUP BY collection_id
        `)) as Array<{ collection_id: string; count: number }>)
      : [];
  const countMap = new Map(counts.map((c) => [c.collection_id, c.count]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      image: r.image,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
      productCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    currentPage: page,
  };
}

export interface CollectionProductRow {
  productId: string;
  productName: string;
  sortOrder: number | null;
}

export interface CollectionDetail extends CollectionListItem {
  mappedProducts: CollectionProductRow[];
}

/** Admin collection detail with ordered mappings. */
export async function getCollectionDetail(id: string): Promise<CollectionDetail | null> {
  const [row] = await db.select().from(collections).where(eq(collections.id, id));
  if (!row) return null;
  const mapped = await db
    .select({
      productId: collectionProducts.productId,
      productName: products.name,
      sortOrder: collectionProducts.sortOrder,
    })
    .from(collectionProducts)
    .innerJoin(products, eq(products.id, collectionProducts.productId))
    .where(eq(collectionProducts.collectionId, id))
    .orderBy(asc(collectionProducts.sortOrder), asc(products.name));
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(collectionProducts)
    .where(eq(collectionProducts.collectionId, id));
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image: row.image,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    productCount: countRow?.count ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mappedProducts: mapped.map((m) => ({
      productId: m.productId,
      productName: m.productName,
      sortOrder: m.sortOrder,
    })),
  };
}

export interface PublicCollectionItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  productCount: number;
}

/**
 * Published collections for the storefront index, in admin-defined order.
 * Unpublished collections are excluded here — never merely hidden in UI.
 */
export async function listPublicCollections(): Promise<PublicCollectionItem[]> {
  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      image: collections.image,
    })
    .from(collections)
    .where(eq(collections.isActive, true))
    .orderBy(asc(collections.sortOrder), desc(collections.createdAt));
  const counts =
    rows.length > 0
      ? ((await db.execute(sql`
          SELECT cp.collection_id, COUNT(*)::int AS count
          FROM collection_products AS cp
          INNER JOIN products AS p ON p.id = cp.product_id
          WHERE cp.collection_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
            AND p.status = 'ACTIVE'
          GROUP BY cp.collection_id
        `)) as Array<{ collection_id: string; count: number }>)
      : [];
  const countMap = new Map(counts.map((c) => [c.collection_id, c.count]));
  return rows.map((r) => ({ ...r, productCount: countMap.get(r.id) ?? 0 }));
}

export interface PublicCollectionProduct {
  productId: string;
  sortOrder: number;
}

export interface PublicCollectionDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  products: PublicCollectionProduct[];
}

/**
 * One published collection with its ordered ACTIVE product ids. Lookup is
 * by slug (the public identifier). Inactive products drop out here so a
 * curated collection never advertises unavailable goods; prices and
 * details resolve per product through the canonical catalog queries.
 */
export async function getPublicCollectionBySlug(
  slug: string,
): Promise<PublicCollectionDetail | null> {
  const [row] = await db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      image: collections.image,
    })
    .from(collections)
    .where(and(eq(collections.slug, slug), eq(collections.isActive, true)));
  if (!row) return null;
  const mappings = await db
    .select({
      productId: collectionProducts.productId,
      sortOrder: collectionProducts.sortOrder,
    })
    .from(collectionProducts)
    .innerJoin(products, eq(products.id, collectionProducts.productId))
    .where(
      and(
        eq(collectionProducts.collectionId, row.id),
        eq(products.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(collectionProducts.sortOrder), asc(products.name));
  return {
    ...row,
    products: mappings.map((m, index) => ({
      productId: m.productId,
      sortOrder: m.sortOrder ?? index,
    })),
  };
}

/** ACTIVE variant prices for a set of products (min-price display + promo input). */
export async function getCollectionVariantPrices(
  productIds: string[],
): Promise<Map<string, Array<{ variantId: string; priceOverride: string | null }>>> {
  const map = new Map<string, Array<{ variantId: string; priceOverride: string | null }>>();
  if (productIds.length === 0) return map;
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      priceOverride: productVariants.priceOverride,
    })
    .from(productVariants)
    .where(
      and(
        inArray(productVariants.productId, productIds),
        eq(productVariants.status, "ACTIVE"),
      ),
    );
  for (const row of rows) {
    const list = map.get(row.productId) ?? [];
    list.push({ variantId: row.variantId, priceOverride: row.priceOverride });
    map.set(row.productId, list);
  }
  return map;
}

export interface CollectionCardData {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  comparePrice: string | null;
  minVariantPrice: string | null;
  primaryImage: { url: string; alt: string | null } | null;
  brand: { name: string } | null;
  averageRating: number | null;
  reviewCount: number;
}

export interface CollectionCard extends CollectionCardData {
  sortOrder: number;
}

/**
 * Full card data for an ordered product list in a single batched pass:
 * products + primary images + brands + min ACTIVE variant prices + review
 * aggregates (approved only). Products missing or inactive since mapping
 * drop out; order follows the input ids.
 */
export async function getCollectionCards(
  productIds: string[],
): Promise<CollectionCard[]> {
  if (productIds.length === 0) return [];
  const { brands } = await import("@/infrastructure/database/schema/catalog");
  const { reviewStatusEnum } = await import("@/infrastructure/database/schema/enums");

  const [productRows, imageRows, brandRows, minPricesRaw, ratingsRaw] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        basePrice: products.basePrice,
        comparePrice: products.comparePrice,
        status: products.status,
        brandId: products.brandId,
      })
      .from(products)
      .where(inArray(products.id, productIds)),
    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        alt: productImages.alt,
      })
      .from(productImages)
      .where(
        and(
          inArray(productImages.productId, productIds),
          eq(productImages.isPrimary, true),
        ),
      ),
    db
      .select({ id: brands.id, name: brands.name })
      .from(brands),
    db.execute(sql`
      SELECT pv.product_id AS "productId",
             MIN(COALESCE(pv.price_override, p.base_price)) AS "minPrice"
      FROM product_variant AS pv
      INNER JOIN products AS p ON p.id = pv.product_id
      WHERE pv.product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
        AND pv.is_active = 'ACTIVE'
      GROUP BY pv.product_id
    `),
    db.execute(sql`
      SELECT r.product_id AS "productId",
             AVG(r.rating)::numeric(3,2) AS "avg",
             COUNT(*)::int AS "count"
      FROM reviews AS r
      WHERE r.product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
        AND r.status = ${reviewStatusEnum.enumValues[1]}
        AND r.rating IS NOT NULL
      GROUP BY r.product_id
    `),
  ]);
  const minPrices = minPricesRaw as unknown as Array<{ productId: string; minPrice: string }>;
  const ratings = ratingsRaw as unknown as Array<{ productId: string; avg: string; count: number }>;

  const imageMap = new Map(imageRows.map((i) => [i.productId, i]));
  const brandMap = new Map(brandRows.map((b) => [b.id, b]));
  const minMap = new Map(minPrices.map((m) => [m.productId, m.minPrice]));
  const ratingMap = new Map(ratings.map((r) => [r.productId, r]));
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  const cards: CollectionCard[] = [];
  productIds.forEach((pid, index) => {
    const p = productMap.get(pid);
    if (!p || p.status !== "ACTIVE") return;
    const img = imageMap.get(pid);
    const rating = ratingMap.get(pid);
    cards.push({
      id: p.id,
      name: p.name,
      slug: p.slug,
      basePrice: p.basePrice,
      comparePrice: p.comparePrice,
      minVariantPrice: minMap.get(pid) ?? null,
      primaryImage: img ? { url: img.url, alt: img.alt } : null,
      brand: p.brandId && brandMap.has(p.brandId) ? { name: brandMap.get(p.brandId)!.name } : null,
      averageRating: rating ? Number(rating.avg) : null,
      reviewCount: rating ? Number(rating.count) : 0,
      sortOrder: index,
    });
  });
  return cards;
}

export interface ProductSearchRow {
  id: string;
  name: string;
  basePrice: string;
  mapped: boolean;
}

/** Product picker for mappings: name search with mapped flags for context. */
export async function searchProductsForCollection(
  collectionId: string,
  query: string,
  limit = 20,
): Promise<ProductSearchRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db
    .select({ id: products.id, name: products.name, basePrice: products.basePrice })
    .from(products)
    .where(ilike(products.name, `%${q}%`))
    .orderBy(products.name)
    .limit(limit);
  if (rows.length === 0) return rows.map((r) => ({ ...r, mapped: false }));
  const mapped = await db
    .select({ productId: collectionProducts.productId })
    .from(collectionProducts)
    .where(
      and(
        eq(collectionProducts.collectionId, collectionId),
        inArray(
          collectionProducts.productId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const mappedSet = new Set(mapped.map((m) => m.productId));
  return rows.map((r) => ({ ...r, mapped: mappedSet.has(r.id) }));
}

import { vi } from "vitest";

const updateTagSpy = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: updateTagSpy,
  revalidatePath: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
} from "../_db";
import {
  collectionProducts,
  collections,
} from "@/infrastructure/database/schema/marketing";
import {
  addProductToCollection,
  createCollection,
  removeProductFromCollection,
  reorderCollectionProducts,
  setCollectionActive,
  updateCollection,
} from "@/modules/collections/application/commands/collections";
import {
  getCollectionCards,
  getCollectionDetail,
  getPublicCollectionBySlug,
  listCollections,
  listPublicCollections,
} from "@/modules/collections/application/queries/collections";
import {
  CollectionConflictError,
  CollectionNotFoundError,
  CollectionValidationError,
} from "@/modules/collections/domain/collection-errors";

const SFX = `mc-${Date.now()}`;
const createdIds: string[] = [];
let categoryId = "";
let brandId = "";
const productIds: string[] = [];

beforeAll(async () => {
  const [cat] = await testDb.insert(categories).values({ slug: `mc-cat-${SFX}`, name: "MC Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `mc-brand-${SFX}`, name: "MC Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  for (let i = 0; i < 3; i += 1) {
    const [p] = await testDb
      .insert(products)
      .values({ slug: `p-${Math.random().toString(36).slice(2, 14)}`, name: `MC Product ${i}`, status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
      .returning();
    productIds.push(p.id);
  }
});

afterAll(async () => {
  for (const id of createdIds) {
    await testDb.delete(collectionProducts).where(eq(collectionProducts.collectionId, id));
  }
  if (createdIds.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await testDb.delete(collections).where(inArray(collections.id, createdIds));
  }
  const { inArray } = await import("drizzle-orm");
  await testDb.delete(products).where(inArray(products.id, productIds));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
});

beforeEach(() => {
  updateTagSpy.mockClear();
});

async function track(id: string): Promise<string> {
  createdIds.push(id);
  return id;
}

describe("collection lifecycle", () => {
  it("creates with derived slugs and starts unpublished", async () => {
    const { id } = await createCollection({ name: `Summer Essentials ${SFX}` });
    await track(id);
    const [row] = await testDb.select().from(collections).where(eq(collections.id, id));
    expect(row!.slug).toBe(`summer-essentials-${SFX}`.toLowerCase());
    expect(row!.isActive).toBe(false);
    expect(updateTagSpy).toHaveBeenCalled();
  });

  it("rejects duplicates, bad slugs, and bad fields", async () => {
    const { id } = await createCollection({ name: `Dup Test ${SFX}` });
    await track(id);
    await expect(createCollection({ name: `Dup Test ${SFX}` })).rejects.toBeInstanceOf(
      CollectionConflictError,
    );
    await expect(
      createCollection({ name: "Something else", slug: `dup-test-${SFX}`.toLowerCase() }),
    ).rejects.toBeInstanceOf(CollectionConflictError);
    await expect(createCollection({ name: "", slug: "valid-slug" })).rejects.toBeInstanceOf(
      CollectionValidationError,
    );
    await expect(createCollection({ name: "x".repeat(121) })).rejects.toBeInstanceOf(
      CollectionValidationError,
    );
    await expect(
      updateCollection({ id, name: "Renamed", slug: "Bad Slug!", isActive: false }),
    ).resolves.toBeUndefined();
    const [renamed] = await testDb.select().from(collections).where(eq(collections.id, id));
    expect(renamed!.slug).toBe("bad-slug");
    await expect(
      updateCollection({ id, name: "Renamed", slug: "!!!", isActive: false }),
    ).rejects.toBeInstanceOf(CollectionValidationError);
    await expect(
      updateCollection({ id: "00000000-0000-0000-0000-000000000000", name: "Missing", isActive: false }),
    ).rejects.toBeInstanceOf(CollectionNotFoundError);
  });

  it("settles concurrent duplicate slugs onto one row", async () => {
    const name = `Race Collection ${SFX}`;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, () => createCollection({ name })),
    );
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason).toBeInstanceOf(CollectionConflictError);
    }
    for (const o of ok) {
      await track((o as PromiseFulfilledResult<{ id: string }>).value.id);
    }
  });

  it("publishes and unpublishes", async () => {
    const { id } = await createCollection({ name: `Pub Test ${SFX}` });
    await track(id);
    await setCollectionActive(id, true);
    const [on] = await testDb.select().from(collections).where(eq(collections.id, id));
    expect(on!.isActive).toBe(true);
    await setCollectionActive(id, false);
    const [off] = await testDb.select().from(collections).where(eq(collections.id, id));
    expect(off!.isActive).toBe(false);
    await expect(
      setCollectionActive("00000000-0000-0000-0000-000000000000", true),
    ).rejects.toBeInstanceOf(CollectionNotFoundError);
  });
});

describe("product mappings and ordering", () => {
  it("appends, dedupes, reorders densely, and removes", async () => {
    const { id } = await createCollection({ name: `Map Test ${SFX}` });
    await track(id);

    await addProductToCollection(id, productIds[0]!);
    await addProductToCollection(id, productIds[1]!);
    await addProductToCollection(id, productIds[2]!);
    await expect(addProductToCollection(id, productIds[0]!)).rejects.toBeInstanceOf(
      CollectionConflictError,
    );
    await expect(
      addProductToCollection(id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(CollectionValidationError);

    let detail = await getCollectionDetail(id);
    expect(detail!.mappedProducts.map((m) => m.productId)).toEqual(productIds);

    // Reorder to reverse; positions persist densely.
    const reversed = [...productIds].reverse();
    await reorderCollectionProducts(id, reversed);
    detail = await getCollectionDetail(id);
    expect(detail!.mappedProducts.map((m) => m.productId)).toEqual(reversed);
    expect(detail!.mappedProducts.map((m) => m.sortOrder)).toEqual([0, 1, 2]);

    // Partial or foreign arrays are rejected without mutation.
    await expect(reorderCollectionProducts(id, [productIds[0]!])).rejects.toBeInstanceOf(
      CollectionConflictError,
    );
    await expect(
      reorderCollectionProducts(id, [...reversed, "00000000-0000-0000-0000-000000000000"]),
    ).rejects.toBeInstanceOf(CollectionConflictError);
    detail = await getCollectionDetail(id);
    expect(detail!.mappedProducts.map((m) => m.productId)).toEqual(reversed);

    // Removal collapses positions.
    await removeProductFromCollection(id, reversed[0]!);
    detail = await getCollectionDetail(id);
    expect(detail!.mappedProducts.map((m) => m.productId)).toEqual(reversed.slice(1));
    expect(detail!.mappedProducts.map((m) => m.sortOrder)).toEqual([0, 1]);
  });

  it("rolls back multi-step failures without partial writes", async () => {
    const { id } = await createCollection({ name: `Tx Test ${SFX}` });
    await track(id);
    await addProductToCollection(id, productIds[0]!);
    // Duplicate append fails; the original mapping is untouched.
    await expect(addProductToCollection(id, productIds[0]!)).rejects.toBeInstanceOf(
      CollectionConflictError,
    );
    const detail = await getCollectionDetail(id);
    expect(detail!.mappedProducts).toHaveLength(1);
  });
});

describe("public storefront queries", () => {
  it("lists only published collections and hides unpublished ones", async () => {
    const pub = await createCollection({ name: `Pub List ${SFX}`, isActive: true });
    const draft = await createCollection({ name: `Draft List ${SFX}`, isActive: false });
    await track(pub.id);
    await track(draft.id);
    await addProductToCollection(pub.id, productIds[0]!);

    const items = await listPublicCollections();
    const slugs = items.map((i) => i.slug);
    expect(slugs).toContain(`pub-list-${SFX}`.toLowerCase());
    expect(slugs).not.toContain(`draft-list-${SFX}`.toLowerCase());

    expect(await getPublicCollectionBySlug(`draft-list-${SFX}`.toLowerCase())).toBeNull();
    expect(await getPublicCollectionBySlug("no-such-collection")).toBeNull();
  });

  it("returns ordered ACTIVE products with card data", async () => {
    const pub = await createCollection({ name: `Cards ${SFX}`, isActive: true });
    await track(pub.id);
    await addProductToCollection(pub.id, productIds[0]!);
    await addProductToCollection(pub.id, productIds[1]!);

    const detail = await getPublicCollectionBySlug(`cards-${SFX}`.toLowerCase());
    expect(detail!.products.map((p) => p.productId)).toEqual([productIds[0], productIds[1]]);

    const cards = await getCollectionCards(detail!.products.map((p) => p.productId));
    expect(cards.map((c) => c.id)).toEqual([productIds[0], productIds[1]]);
    expect(cards[0]!.name).toBe("MC Product 0");
    // Card slug is the product's own URL identifier (no longer the id).
    const [cardProduct] = await testDb
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.id, productIds[0]!));
    expect(cards[0]!.slug).toBe(cardProduct!.slug);
    expect(cards[0]!.basePrice).toBe("20.00");

    // Archiving a product drops it from public results.
    await testDb.update(products).set({ status: "ARCHIVE" }).where(eq(products.id, productIds[1]!));
    const after = await getPublicCollectionBySlug(`cards-${SFX}`.toLowerCase());
    expect(after!.products.map((p) => p.productId)).toEqual([productIds[0]]);
    await testDb.update(products).set({ status: "ACTIVE" }).where(eq(products.id, productIds[1]!));
  });

  it("unpublishing hides the collection immediately", async () => {
    const pub = await createCollection({ name: `Hide ${SFX}`, isActive: true });
    await track(pub.id);
    expect(await getPublicCollectionBySlug(`hide-${SFX}`.toLowerCase())).not.toBeNull();
    await setCollectionActive(pub.id, false);
    expect(await getPublicCollectionBySlug(`hide-${SFX}`.toLowerCase())).toBeNull();
    expect(
      (await listPublicCollections()).some((c) => c.id === pub.id),
    ).toBe(false);
  });
});

describe("admin listing", () => {
  it("searches, filters, and paginates with product counts", async () => {
    const a = await createCollection({ name: `Adm A ${SFX}`, isActive: true });
    const b = await createCollection({ name: `Adm B ${SFX}`, isActive: false });
    await track(a.id);
    await track(b.id);
    await addProductToCollection(a.id, productIds[0]!);
    await addProductToCollection(a.id, productIds[1]!);

    const search = await listCollections({ query: `Adm A ${SFX}` });
    expect(search.items.map((i) => i.id)).toEqual([a.id]);
    expect(search.items[0]!.productCount).toBe(2);

    const active = await listCollections({ isActive: true, pageSize: 50 });
    expect(active.items.some((i) => i.id === a.id)).toBe(true);
    expect(active.items.some((i) => i.id === b.id)).toBe(false);

    const p1 = await listCollections({ query: "Adm", page: 1, pageSize: 1 });
    expect(p1.totalCount).toBeGreaterThanOrEqual(2);
    expect(p1.totalPages).toBeGreaterThanOrEqual(2);
  });
});

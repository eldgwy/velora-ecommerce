import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { updateTag } from "next/cache";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
} from "../_db";
import {
  promotionProducts,
  promotions,
} from "@/infrastructure/database/schema/discounts";
import {
  createPromotion,
  mapProductToPromotion,
  setPromotionActive,
  unmapProductFromPromotion,
  updatePromotion,
} from "@/modules/promotions/application/commands/promotions";
import {
  getPromotionDetail,
  listPromotions,
} from "@/modules/promotions/application/queries/promotions";
import {
  PromotionConflictError,
  PromotionNotFoundError,
  PromotionValidationError,
} from "@/modules/promotions/domain/promotion-errors";

const SFX = `pa-${Date.now()}`;
const createdIds: string[] = [];
let categoryId = "";
let brandId = "";
let productId = "";
let product2Id = "";

beforeAll(async () => {
  const [cat] = await testDb.insert(categories).values({ slug: `pa-cat-${SFX}`, name: "PA Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `pa-brand-${SFX}`, name: "PA Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [p1] = await testDb
    .insert(products)
    .values({ name: "PA Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  const [p2] = await testDb
    .insert(products)
    .values({ name: "PA Product 2", status: "ACTIVE", basePrice: "30.00", categoryId, brandId })
    .returning();
  productId = p1.id;
  product2Id = p2.id;
  await testDb.insert(productVariants).values([
    { productId, sku: `PA-SKU-${SFX}`, status: "ACTIVE" },
    { productId: product2Id, sku: `PA-SKU2-${SFX}`, status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await testDb.delete(promotionProducts).where(
    inArray(
      promotionProducts.productId,
      [productId, product2Id],
    ),
  );
  if (createdIds.length > 0) {
    await testDb.delete(promotions).where(inArray(promotions.id, createdIds));
  }
  await testDb.delete(productVariants).where(
    inArray(
      productVariants.productId,
      [productId, product2Id],
    ),
  );
  await testDb.delete(products).where(inArray(products.id, [productId, product2Id]));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
});

describe("promotion creation", () => {
  it("creates percentage and fixed promotions", async () => {
    const pct = await createPromotion({
      name: `PA Pct ${SFX}`,
      type: "PERCENTAGE",
      value: "12.5",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      isActive: true,
    });
    createdIds.push(pct.id);
    const [row] = await testDb.select().from(promotions).where(eq(promotions.id, pct.id));
    expect(row!.type).toBe("PERCENTAGE");
    expect(row!.value).toBe("12.5");

    const fixed = await createPromotion({
      name: `PA Fixed ${SFX}`,
      description: "Flat five",
      type: "FIXED",
      value: "5.00",
    });
    createdIds.push(fixed.id);
    const [frow] = await testDb.select().from(promotions).where(eq(promotions.id, fixed.id));
    expect(frow!.description).toBe("Flat five");
    expect(frow!.isActive).toBe(true);
    expect(frow!.startsAt).not.toBeNull();
  });

  it("rejects invalid names, values, and windows", async () => {
    const bad = [
      { name: "", type: "PERCENTAGE", value: "10" },
      { name: `p150 ${SFX}`, type: "PERCENTAGE", value: "150" },
      { name: `p0 ${SFX}`, type: "PERCENTAGE", value: "0" },
      { name: `f0 ${SFX}`, type: "FIXED", value: "0" },
      { name: `fneg ${SFX}`, type: "FIXED", value: "-2" },
      { name: `f3dp ${SFX}`, type: "FIXED", value: "1.005" },
      {
        name: `winv ${SFX}`,
        type: "FIXED",
        value: "1.00",
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 60_000),
      },
    ] as const;
    for (const input of bad) {
      await expect(
        createPromotion({ ...input, type: input.type as "PERCENTAGE" | "FIXED" }),
      ).rejects.toBeInstanceOf(PromotionValidationError);
    }
  });
});

describe("product mappings", () => {
  it("maps, dedupes, and unmaps products", async () => {
    const { id } = await createPromotion({ name: `PA Map ${SFX}`, type: "FIXED", value: "2.00" });
    createdIds.push(id);

    await mapProductToPromotion(id, productId);
    expect(updateTag).toHaveBeenCalled();
    await expect(mapProductToPromotion(id, productId)).rejects.toBeInstanceOf(
      PromotionConflictError,
    );
    await expect(
      mapProductToPromotion(id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(PromotionValidationError);
    await expect(
      mapProductToPromotion("00000000-0000-0000-0000-000000000000", productId),
    ).rejects.toBeInstanceOf(PromotionNotFoundError);

    const detail = await getPromotionDetail(id);
    expect(detail!.mappedProducts.map((m) => m.productId)).toContain(productId);

    await unmapProductFromPromotion(id, productId);
    const after = await getPromotionDetail(id);
    expect(after!.mappedProducts).toHaveLength(0);
  });
});

describe("activation and listing", () => {
  it("toggles activation and reports missing promotions", async () => {
    const { id } = await createPromotion({ name: `PA Tgl ${SFX}`, type: "FIXED", value: "1.00" });
    createdIds.push(id);
    await setPromotionActive(id, false);
    const [off] = await testDb.select().from(promotions).where(eq(promotions.id, id));
    expect(off!.isActive).toBe(false);
    expect(off!.startsAt).not.toBeNull();
    await setPromotionActive(id, true);
    await expect(setPromotionActive("00000000-0000-0000-0000-000000000000", true)).rejects.toBeInstanceOf(
      PromotionNotFoundError,
    );
  });

  it("searches, filters, and paginates with product counts", async () => {
    const now = Date.now();
    const a = await createPromotion({ name: `PA List A ${SFX}`, type: "FIXED", value: "1.00", isActive: false });
    const b = await createPromotion({
      name: `PA List B ${SFX}`,
      type: "FIXED",
      value: "1.00",
      startsAt: new Date(now + 3_600_000),
      endsAt: new Date(now + 7_200_000),
    });
    const c = await createPromotion({
      name: `PA List C ${SFX}`,
      type: "FIXED",
      value: "1.00",
      startsAt: new Date(now - 7_200_000),
      endsAt: new Date(now - 3_600_000),
    });
    for (const r of [a, b, c]) createdIds.push(r.id);
    await mapProductToPromotion(a.id, productId);
    await mapProductToPromotion(a.id, product2Id);

    const search = await listPromotions({ query: `PA List A ${SFX}`.toLowerCase(), pageSize: 20 });
    expect(search.items.map((i) => i.id)).toEqual([a.id]);
    expect(search.items[0]!.productCount).toBe(2);

    const inactive = await listPromotions({ status: "inactive", pageSize: 50 });
    expect(inactive.items.some((i) => i.id === a.id)).toBe(true);
    const scheduled = await listPromotions({ status: "scheduled", pageSize: 50 });
    expect(scheduled.items.some((i) => i.id === b.id)).toBe(true);
    const expired = await listPromotions({ status: "expired", pageSize: 50 });
    expect(expired.items.some((i) => i.id === c.id)).toBe(true);

    const p1 = await listPromotions({ query: "PA List", page: 1, pageSize: 2 });
    expect(p1.totalCount).toBeGreaterThanOrEqual(3);
    expect(p1.totalPages).toBeGreaterThanOrEqual(2);
  });

  it("edits terms without touching mappings", async () => {
    const { id } = await createPromotion({ name: `PA Edit ${SFX}`, type: "FIXED", value: "2.00" });
    createdIds.push(id);
    await mapProductToPromotion(id, productId);
    await updatePromotion({
      id,
      name: `PA Edit ${SFX}`,
      type: "PERCENTAGE",
      value: "20",
      isActive: true,
    });
    const [row] = await testDb.select().from(promotions).where(eq(promotions.id, id));
    expect(row!.type).toBe("PERCENTAGE");
    expect(row!.value).toBe("20");
    const detail = await getPromotionDetail(id);
    expect(detail!.mappedProducts.map((m) => m.productId)).toContain(productId);
  });
});

import { vi } from "vitest";

const adminSession = vi.hoisted(() => ({
  user: { id: "of-admin", role: "ADMIN", status: "ACTIVE", email: "a@ex.com", name: "Admin" },
}));
const requireAdminSpy = vi.hoisted(() => vi.fn().mockResolvedValue(adminSession));

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/shared/lib/guards", () => ({ requireAdmin: requireAdminSpy }));
vi.mock("@/shared/lib/mail", () => ({
  sendMail: vi.fn(async () => ({ accepted: ["a@ex.com"], messageId: "m1" })),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { testDb } from "../_db";
import {
  categories,
  brands,
  products,
  productVariants,
} from "../_db";
import { orderAddresses, orderItems, orders } from "@/infrastructure/database/schema/orders";
import { user } from "@/infrastructure/database/schema/auth";
import {
  getShippingManifest,
  listOrdersForAdmin,
} from "@/modules/orders/application/queries/orders";
import {
  getShippingManifestAction,
  shipOrdersBatchAction,
} from "@/modules/orders/presentation/actions/admin-order.actions";

const SFX = `of-${Date.now()}`;
let userId = "";
let categoryId = "";
let brandId = "";
let productId = "";
let variantId = "";
let procOrderId = "";
let procOrderNumber = "";
let shipOrderId = "";
let cancelledOrderId = "";

async function seedOrder(
  tag: string,
  status: "PROCESSING" | "SHIPPED" | "CANCELLED",
  name: string,
) {
  const [order] = await testDb
    .insert(orders)
    .values({
      orderNumber: `OF-${tag}-${SFX}`.toUpperCase(),
      userId,
      status,
      subtotal: "20.00",
      discountAmount: "0.00",
      shippingAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "20.00",
      currency: "USD",
      paymentStatus: "PAID",
    })
    .returning();
  await testDb.insert(orderAddresses).values([
    {
      orderId: order.id,
      type: "SHIPPING",
      firstName: name,
      lastName: "Doe",
      phone: "+15551230000",
      country: "US",
      city: "Springfield",
      state: "IL",
      postalCode: "62701",
      addressLine1: "1 Main St",
      addressLine2: null,
    },
  ]);
  await testDb.insert(orderItems).values({
    orderId: order.id,
    variantId,
    productName: "Fulfillment Widget",
    sku: `OF-SKU-${SFX}`,
    quantity: 2,
    unitPrice: "10.00",
    totalAmount: "20.00",
    reservationStatus: "COMMITTED",
  });
  return order;
}

beforeAll(async () => {
  const [u] = await testDb
    .insert(user)
    .values({ id: `of-u-${SFX}`, name: "Ful Fillment", email: `fulfill-${SFX}@ex.com` })
    .returning();
  userId = u.id;
  const [cat] = await testDb.insert(categories).values({ slug: `of-cat-${SFX}`, name: "OF Cat" }).returning();
  const [br] = await testDb.insert(brands).values({ slug: `of-brand-${SFX}`, name: "OF Brand" }).returning();
  categoryId = cat.id;
  brandId = br.id;
  const [prod] = await testDb
    .insert(products)
    .values({ name: "OF Product", status: "ACTIVE", basePrice: "20.00", categoryId, brandId })
    .returning();
  productId = prod.id;
  const [variant] = await testDb
    .insert(productVariants)
    .values({ productId, sku: `OF-SKU-${SFX}`, status: "ACTIVE" })
    .returning();
  variantId = variant.id;
  const proc = await seedOrder("PROC", "PROCESSING", "Ful");
  procOrderId = proc.id;
  procOrderNumber = proc.orderNumber;
  const shp = await seedOrder("SHIP", "SHIPPED", "Ful");
  shipOrderId = shp.id;
  const cxl = await seedOrder("CXL", "CANCELLED", "Ful");
  cancelledOrderId = cxl.id;
});

afterAll(async () => {
  const ids = [procOrderId, shipOrderId, cancelledOrderId].filter(Boolean);
  if (ids.length > 0) {
    await testDb.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await testDb.delete(orderAddresses).where(inArray(orderAddresses.orderId, ids));
    await testDb.delete(orders).where(inArray(orders.id, ids));
  }
  await testDb.delete(user).where(eq(user.id, userId));
  await testDb.delete(productVariants).where(eq(productVariants.id, variantId));
  await testDb.delete(products).where(eq(products.id, productId));
  await testDb.delete(brands).where(eq(brands.id, brandId));
  await testDb.delete(categories).where(eq(categories.id, categoryId));
});

describe("order grid filters", () => {
  it("filters by status, customer, order number, and dates independently", async () => {
    const byStatus = await listOrdersForAdmin({ status: "PROCESSING" });
    expect(byStatus.items.map((i) => i.id)).toContain(procOrderId);
    expect(byStatus.items.map((i) => i.id)).not.toContain(cancelledOrderId);

    const byCustomer = await listOrdersForAdmin({ customer: "ful fill" });
    expect(byCustomer.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([procOrderId, shipOrderId, cancelledOrderId]),
    );
    const byCustomerMiss = await listOrdersForAdmin({ customer: "nobody-here" });
    expect(byCustomerMiss.items.map((i) => i.id)).not.toContain(procOrderId);

    const byNumber = await listOrdersForAdmin({ orderNumber: `  ${procOrderNumber.toLowerCase()}  ` });
    expect(byNumber.items.map((i) => i.id)).toContain(procOrderId);

    const byDate = await listOrdersForAdmin({
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    });
    expect(byDate.items.map((i) => i.id)).toContain(procOrderId);
    const byDateMiss = await listOrdersForAdmin({
      from: new Date("2020-01-01T00:00:00Z"),
      to: new Date("2020-01-02T00:00:00Z"),
    });
    expect(byDateMiss.items.map((i) => i.id)).not.toContain(procOrderId);
  });

  it("combines filters and stays deterministic", async () => {
    const combined = await listOrdersForAdmin({ status: "PROCESSING", customer: "Ful Fillment" });
    expect(combined.items.map((i) => i.id)).toContain(procOrderId);
    const again = await listOrdersForAdmin({ status: "PROCESSING", customer: "Ful Fillment" });
    expect(again.items.map((i) => i.id)).toEqual(combined.items.map((i) => i.id));
  });

  it("exposes customer names without leaking private fields", async () => {
    const res = await listOrdersForAdmin({ orderNumber: procOrderNumber });
    expect(res.items[0]!.customerName).toBe("Ful Fillment");
    expect(Object.keys(res.items[0]!).sort()).toEqual(
      ["createdAt", "currency", "customerName", "id", "itemCount", "orderNumber", "paymentStatus", "status", "totalAmount", "userId"].sort(),
    );
  });
});

describe("batch shipment", () => {
  it("ships eligible orders and reports mixed outcomes per order", async () => {
    const res = await shipOrdersBatchAction({
      orderIds: [procOrderId, shipOrderId, cancelledOrderId, "00000000-0000-0000-0000-000000000000"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error("expected ok");
    // procOrderId was the only shippable row (shipOrderId already SHIPPED
    // replays idempotently as success; cancelled + missing fail).
    expect(res.data.succeeded.map((s) => s.orderId)).toEqual(
      expect.arrayContaining([procOrderId, shipOrderId]),
    );
    expect(res.data.failed.map((f) => f.orderId)).toEqual(
      expect.arrayContaining([cancelledOrderId, "00000000-0000-0000-0000-000000000000"]),
    );

    const [shipped] = await testDb.select().from(orders).where(eq(orders.id, procOrderId));
    expect(shipped!.status).toBe("SHIPPED");
  });

  it("rejects oversized batches and unauthorized callers", async () => {
    const tooMany = await shipOrdersBatchAction({
      orderIds: Array.from({ length: 51 }, () => procOrderId),
    });
    expect(tooMany.ok).toBe(false);

    requireAdminSpy.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(shipOrdersBatchAction({ orderIds: [procOrderId] })).rejects.toThrow("FORBIDDEN");
  });
});

describe("shipping manifest", () => {
  it("includes eligible orders with trusted address and line data", async () => {
    const manifest = await getShippingManifest([procOrderId, shipOrderId]);
    expect(manifest.excluded).toEqual([]);
    expect(manifest.included.map((m) => m.orderId).sort()).toEqual(
      [procOrderId, shipOrderId].sort(),
    );
    const proc = manifest.included.find((m) => m.orderId === procOrderId)!;
    expect(proc.orderNumber).toBe(procOrderNumber);
    expect(proc.customerName).toBe("Ful Fillment");
    expect(proc.address?.addressLine1).toBe("1 Main St");
    expect(proc.address?.phone).toBe("+15551230000");
    expect(proc.items).toEqual([
      expect.objectContaining({ productName: "Fulfillment Widget", quantity: 2, sku: `OF-SKU-${SFX}` }),
    ]);
    // No payment secrets, no credentials anywhere in the payload.
    expect(JSON.stringify(manifest)).not.toMatch(/secret|password|token|card/i);
  });

  it("excludes ineligible and missing orders with reasons", async () => {
    const manifest = await getShippingManifest([cancelledOrderId, "00000000-0000-0000-0000-000000000000"]);
    expect(manifest.included).toEqual([]);
    expect(manifest.excluded).toHaveLength(2);
    expect(manifest.excluded[0]!.reason).toMatch(/CANCELLED/);

    const res = await getShippingManifestAction({ orderIds: [cancelledOrderId] });
    expect(res.ok).toBe(true);
  });

  it("rejects unauthorized manifest access", async () => {
    requireAdminSpy.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(getShippingManifestAction({ orderIds: [procOrderId] })).rejects.toThrow("FORBIDDEN");
  });
});

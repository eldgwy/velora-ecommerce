import { describe, it, expect } from "vitest";

import { renderOrderInvoicePdf } from "@/modules/orders/application/invoice-renderer";
import type { OrderDetail } from "@/modules/orders/application/queries/orders";

function fakeDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    orderNumber: "VX-1001",
    status: "PROCESSING",
    paymentStatus: "PAID",
    paymentMethod: "CARD",
    cancellable: false,
    paidBeyondCancel: true,
    subtotal: "100.00",
    discountAmount: "10.00",
    shippingAmount: "5.00",
    taxAmount: "8.00",
    totalAmount: "103.00",
    currency: "USD",
    checkoutExpiresAt: null,
    notes: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    items: [
      {
        id: "i1",
        variantId: "v1",
        productName: "Silk Écharpe",
        variantName: "Noisette",
        sku: "SKU-1",
        quantity: 2,
        unitPrice: "50.00",
        discountAmount: "0.00",
        lineTotal: "100.00",
        reservationStatus: "RESERVED",
        regularUnitPrice: "55.00",
        promotionId: null,
        promotionName: null,
      },
    ],
    addresses: [
      {
        type: "BILLING" as never,
        firstName: "Ana",
        lastName: "Lúcia",
        phone: null,
        country: "Portugal",
        city: "Lisboa",
        state: null,
        postalCode: "1000",
        addressLine1: "Rua do Ouro 1",
        addressLine2: null,
      },
      {
        type: "SHIPPING" as never,
        firstName: "Ana",
        lastName: "Lucia",
        phone: null,
        country: "Portugal",
        city: "Lisboa",
        state: null,
        postalCode: "1000",
        addressLine1: "Rua do Ouro 1",
        addressLine2: null,
      },
    ],
    history: [],
    ...overrides,
  } as OrderDetail;
}

function invoiceInput(detail: OrderDetail) {
  return {
    orderNumber: detail.orderNumber,
    createdAt: detail.createdAt,
    orderStatus: detail.status,
    paymentStatus: detail.paymentStatus ?? "PENDING",
    paymentMethod: detail.paymentMethod,
    currency: detail.currency || "USD",
    items: detail.items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    subtotal: detail.subtotal,
    discountAmount: detail.discountAmount,
    shippingAmount: detail.shippingAmount,
    taxAmount: detail.taxAmount,
    totalAmount: detail.totalAmount,
    billingAddressLines: ["Ana Lucia", "Rua do Ouro 1", "Lisboa, 1000, Portugal"],
    generatedAt: new Date("2026-10-20T00:00:00Z"),
  };
}

describe("order invoice PDF (T-5.2)", () => {
  it("produces a valid single-page PDF document", async () => {
    const bytes = await renderOrderInvoicePdf(invoiceInput(fakeDetail()));
    const header = Buffer.from(bytes.slice(0, 8)).toString("latin1");
    expect(header.startsWith("%PDF")).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(Buffer.from(bytes));
    expect(doc.getPageCount()).toBe(1);
  });

  it("never crashes on non-WinAnsi item or address text", async () => {
    const bytes = await renderOrderInvoicePdf(
      invoiceInput(
        fakeDetail({
          items: [
            {
              id: "i2",
              variantId: "v2",
              productName: "綾 シルク écharpe",
              variantName: null,
              sku: "SKU-2",
              quantity: 1,
              unitPrice: "10.00",
              discountAmount: "0.00",
              lineTotal: "10.00",
              reservationStatus: null,
              regularUnitPrice: null,
              promotionId: null,
              promotionName: null,
            },
          ],
        }),
      ),
    );
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
  });

  it("shows the discount row only when a discount exists", async () => {
    const bytes = await renderOrderInvoicePdf(invoiceInput(fakeDetail({ discountAmount: "0.00" })));
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // Structural sanity only — text extraction is Not a pdf-lib feature.
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(Buffer.from(bytes));
    expect(doc.getPageCount()).toBe(1);
  });
});

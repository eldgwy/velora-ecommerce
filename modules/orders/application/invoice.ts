import { getOrderDetail } from "@/modules/orders/application/queries/orders";

import { addressLines, renderOrderInvoicePdf } from "./invoice-renderer";

/**
 * Ownership-scoped invoice document for one order. Customer scope is
 * enforced inside getOrderDetail (wrong owner → OrderNotFoundError); admin
 * scope is delegated to the caller's requireAdmin guard.
 */
export async function buildOrderInvoiceDocument(
  orderId: string,
  scope: { userId: string } | { admin: true },
): Promise<Uint8Array> {
  const detail = await getOrderDetail(orderId, scope);
  return renderOrderInvoicePdf({
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
    billingAddressLines: addressLines(detail, "BILLING"),
    generatedAt: new Date(),
  });
}

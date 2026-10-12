import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import {
  orderAddresses,
  orderItems,
  orders,
  orderStatusHistories,
  payments,
} from "@/infrastructure/database/schema/orders";
import { OrderNotFoundError } from "@/modules/orders/domain/errors/order-errors";

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string | null;
  itemCount: number;
  totalAmount: string;
  currency: string;
  createdAt: Date;
  /** Populated for staff views only. */
  userId?: string;
}

export interface PaginatedOrders {
  items: OrderListItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export interface OrderDetailItem {
  id: string;
  variantId: string;
  productName: string | null;
  variantName: string | null;
  sku: string;
  quantity: number;
  unitPrice: string | null;
  discountAmount: string | null;
  lineTotal: string | null;
  reservationStatus: string;
}

export interface OrderDetailAddress {
  type: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
}

export interface OrderHistoryEvent {
  id: string;
  status: string;
  previousStatus: string | null;
  eventType: string | null;
  actorType: string | null;
  note: string | null;
  createdAt: Date;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string | null;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  paymentMethod: string | null;
  checkoutExpiresAt: Date | null;
  notes: string | null;
  createdAt: Date;
  items: OrderDetailItem[];
  addresses: OrderDetailAddress[];
  history: OrderHistoryEvent[];
  /** Customer-cancel eligibility, computed server-side from live state. */
  cancellable: boolean;
  paidBeyondCancel: boolean;
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function pageWindow(page: number, pageSize: number): { limit: number; offset: number } {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeSize = Number.isInteger(pageSize) && pageSize > 0
    ? Math.min(pageSize, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { limit: safeSize, offset: (safePage - 1) * safeSize };
}

/**
 * Customer order history: strictly scoped to `userId` from the verified
 * session. Stable ordering (createdAt DESC, id DESC) with total counts —
 * never loads the full history.
 */
export async function listCustomerOrders(
  userId: string,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PaginatedOrders> {
  const { limit, offset } = pageWindow(page, pageSize);

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      totalAmount: orders.totalAmount,
      currency: orders.currency,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.userId, userId));

  const itemCounts = rows.length > 0
    ? await db
        .select({
          orderId: orderItems.orderId,
          count: sql<number>`count(*)::int`,
          qty: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
        .groupBy(orderItems.orderId)
    : [];
  const qtyByOrder = new Map(itemCounts.map((c) => [c.orderId, c.qty]));

  return {
    items: rows.map((r) => ({
      ...r,
      itemCount: qtyByOrder.get(r.id) ?? 0,
    })),
    totalCount: count,
    totalPages: Math.max(1, Math.ceil(count / limit)),
    currentPage: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: limit,
  };
}

export interface AdminOrderFilters {
  status?: string;
  paymentStatus?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Staff order browser: optional status filters + the same stable pagination.
 * Callers must enforce `requireAdmin` — this query itself takes no identity.
 */
export async function listOrdersForAdmin(filters: AdminOrderFilters = {}): Promise<PaginatedOrders> {
  const { limit, offset } = pageWindow(filters.page ?? 1, filters.pageSize ?? DEFAULT_PAGE_SIZE);
  const conditions = [];
  if (filters.status) conditions.push(eq(orders.status, filters.status as typeof orders.status.enumValues[number]));
  if (filters.paymentStatus) {
    conditions.push(eq(orders.paymentStatus, filters.paymentStatus as NonNullable<typeof orders.paymentStatus.enumValues>[number]));
  }

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      totalAmount: orders.totalAmount,
      currency: orders.currency,
      createdAt: orders.createdAt,
      userId: orders.userId,
    })
    .from(orders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const itemCounts = rows.length > 0
    ? await db
        .select({
          orderId: orderItems.orderId,
          qty: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
        .groupBy(orderItems.orderId)
    : [];
  const qtyByOrder = new Map(itemCounts.map((c) => [c.orderId, c.qty]));

  return {
    items: rows.map((r) => ({ ...r, itemCount: qtyByOrder.get(r.id) ?? 0 })),
    totalCount: count,
    totalPages: Math.max(1, Math.ceil(count / limit)),
    currentPage: filters.page ?? 1,
    pageSize: limit,
  };
}

/**
 * Order details from immutable snapshots — historical amounts and
 * descriptions are read as stored, never repriced from the live catalog.
 * Ownership enforced: customer scope requires `order.userId === userId`;
 * pass `{ admin: true }` only after `requireAdmin`.
 */
export async function getOrderDetail(
  orderId: string,
  scope: { userId: string } | { admin: true },
): Promise<OrderDetail> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new OrderNotFoundError(orderId);
  if ("userId" in scope && order.userId !== scope.userId) {
    throw new OrderNotFoundError(orderId);
  }

  const [items, addresses, history, paymentRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    db.select().from(orderAddresses).where(eq(orderAddresses.orderId, orderId)),
    db
      .select()
      .from(orderStatusHistories)
      .where(eq(orderStatusHistories.orderId, orderId))
      .orderBy(desc(orderStatusHistories.createdAt), desc(orderStatusHistories.id)),
    db
      .select({ paymentMethod: payments.paymentMethod, status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, orderId)),
  ]);

  // No payment secrets leave the server: method + status only.
  const paymentMethod = paymentRows[0]?.paymentMethod ?? null;
  // BR-014 + refund gap: customers may cancel PENDING unpaid orders only.
  // Anything else needs support (paid) or is past self-service (fulfilled).
  const cancellable = order.status === "PENDING" && (order.paymentStatus ?? "PENDING") === "PENDING";
  const paidBeyondCancel = order.status !== "CANCELLED" && !cancellable;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    shippingAmount: order.shippingAmount,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    currency: order.currency,
    paymentMethod,
    checkoutExpiresAt: order.checkoutExpiresAt,
    notes: order.notes,
    createdAt: order.createdAt,
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountAmount: i.discountAmount,
      lineTotal: i.totalAmount,
      reservationStatus: i.reservationStatus,
    })),
    addresses: addresses.map((a) => ({
      type: a.type,
      firstName: a.firstName,
      lastName: a.lastName,
      phone: a.phone,
      country: a.country,
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      addressLine1: a.addressLine1,
      addressLine2: a.addressLine2,
    })),
    history: history.map((h) => ({
      id: h.id,
      status: h.status,
      previousStatus: h.previousStatus,
      eventType: h.eventType,
      actorType: h.actorType,
      note: h.note,
      createdAt: h.createdAt,
    })),
    cancellable,
    paidBeyondCancel,
  };
}

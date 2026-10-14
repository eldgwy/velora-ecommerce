import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatPrice } from "@/shared/lib/utils";
import { formatDate } from "@/shared/lib/format";
import { getAdminOrderDetailsAction } from "@/modules/orders/presentation/actions/admin-order.actions";
import { getRefundSummaryAction } from "@/modules/payments/presentation/actions/refund.actions";
import { getOrderReturnsAction } from "@/modules/returns/presentation/actions/return.actions";
import { AdminReturnControls } from "@/modules/returns/presentation/components/admin-return-controls";
import { OrderStatusBadge } from "@/modules/orders/presentation/components/order-status-badge";
import { AdminOrderControls } from "@/modules/orders/presentation/components/admin-order-controls";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Order details — VELORA Admin",
};

interface AdminOrderDetailsPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrderDetailsPage({ params }: AdminOrderDetailsPageProps) {
  const { id } = await params;
  const res = await getAdminOrderDetailsAction(id);
  if (!res.ok || !res.data) {
    if (!res.ok && res.error === "Order not found.") notFound();
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load that order</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        <Button size="lg" render={<Link href="/admin/orders">Back to orders</Link>} />
      </div>
    );
  }

  const order = res.data;
  const shipping = order.addresses.find((a) => a.type === "SHIPPING");
  const [refundSummaryRes, returnsRes] = await Promise.all([
    getRefundSummaryAction(id),
    getOrderReturnsAction(id),
  ]);
  const refundSummary = refundSummaryRes.ok ? (refundSummaryRes.data ?? null) : null;
  const returnCases = returnsRes.ok ? (returnsRes.data ?? []) : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/admin/orders">← All orders</Link>} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{order.orderNumber}</h1>
          <OrderStatusBadge status={order.status} />
          <OrderStatusBadge status={order.paymentStatus} kind="payment" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Placed {formatDate(order.createdAt)} · {formatPrice(order.totalAmount)} {order.currency}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <section className="rounded-xl bg-white p-5 ring-1 ring-foreground/10" aria-label="Items">
            <h2 className="mb-3 text-base font-semibold">Items (snapshots)</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.productName ?? "Item"}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku} · Qty {item.quantity} · reservation {item.reservationStatus}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium">
                    {item.lineTotal ? formatPrice(item.lineTotal) : "—"}
                  </span>
                </li>
              ))}
            </ul>
            <Separator className="my-3" />
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatPrice(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discounts</dt>
                <dd>−{formatPrice(order.discountAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd>{formatPrice(order.shippingAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd>{formatPrice(order.taxAmount)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd>{formatPrice(order.totalAmount)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl bg-white p-5 ring-1 ring-foreground/10" aria-label="Audit trail">
            <h2 className="mb-3 text-base font-semibold">Event history</h2>
            {order.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events recorded yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {order.history.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <OrderStatusBadge status={event.status} />
                        {event.eventType ? (
                          <span className="text-xs text-muted-foreground">{event.eventType}</span>
                        ) : null}
                        {event.actorType ? (
                          <span className="text-xs text-muted-foreground">by {event.actorType}</span>
                        ) : null}
                      </div>
                      {event.previousStatus ? (
                        <span className="text-xs text-muted-foreground">
                          {event.previousStatus} → {event.status}
                        </span>
                      ) : null}
                      {event.note ? (
                        <span className="text-xs text-muted-foreground">{event.note}</span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-xl bg-white p-5 ring-1 ring-foreground/10" aria-label="Fulfillment actions">
            <AdminOrderControls
              orderId={order.id}
              status={order.status}
              paymentStatus={order.paymentStatus}
              paymentMethod={order.paymentMethod}
            />
          </section>
          <section className="rounded-xl bg-white p-5 ring-1 ring-foreground/10" aria-label="Refunds and returns">
            <h2 className="mb-3 text-base font-semibold">Refunds & returns</h2>
            <AdminReturnControls
              orderId={order.id}
              orderLines={order.items.map((item) => ({
                id: item.id,
                productName: item.productName ?? null,
                sku: item.sku,
                quantity: item.quantity,
              }))}
              cases={returnCases}
              refundSummary={refundSummary}
            />
          </section>
          <section className="rounded-xl bg-white p-5 text-sm ring-1 ring-foreground/10" aria-label="Delivery">
            <h2 className="mb-2 text-base font-semibold">Ship to</h2>
            <p className="font-medium">
              {[shipping?.firstName, shipping?.lastName].filter(Boolean).join(" ") || "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {shipping?.addressLine1 ?? ""}
              <br />
              {[shipping?.city, shipping?.state, shipping?.postalCode].filter(Boolean).join(", ")}
              <br />
              {shipping?.country ?? ""}
              {shipping?.phone ? ` · ${shipping.phone}` : ""}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

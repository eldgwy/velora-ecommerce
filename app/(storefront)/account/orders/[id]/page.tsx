import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatPrice } from "@/shared/lib/utils";
import { formatDate } from "@/shared/lib/format";
import { getOrderDetailsAction } from "@/modules/orders/presentation/actions/order.actions";
import { OrderStatusBadge } from "@/modules/orders/presentation/components/order-status-badge";
import { CancelOrderButton } from "@/modules/orders/presentation/components/cancel-order-button";

export const dynamic = "force-dynamic";

interface OrderDetailsPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: OrderDetailsPageProps) {
  return { title: `Order ${(await params).id.slice(0, 8)} — VELORA` };
}

/**
 * Customer order details, rendered entirely from immutable snapshots.
 * Historical amounts are shown as stored — never repriced from the catalog.
 */
export default async function CustomerOrderDetailsPage({ params }: OrderDetailsPageProps) {
  const { id } = await params;
  const res = await getOrderDetailsAction(id);
  if (!res.ok || !res.data) {
    if (!res.ok && res.error === "Order not found.") notFound();
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <h1 className="text-2xl font-semibold">We couldn&apos;t load that order</h1>
          <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
          <Button size="lg" render={<Link href="/account/orders">Back to orders</Link>} />
        </div>
      </main>
    );
  }

  const order = res.data;
  const shipping = order.addresses.find((a) => a.type === "SHIPPING");
  const billing = order.addresses.find((a) => a.type === "BILLING");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Button variant="ghost" size="sm" render={<Link href="/account/orders">← All orders</Link>} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.status} />
        <OrderStatusBadge status={order.paymentStatus} kind="payment" />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Placed {formatDate(order.createdAt)}
        {order.checkoutExpiresAt && order.status === "PENDING"
          ? ` · pay by ${formatDate(order.checkoutExpiresAt)}`
          : ""}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Items">
            <h2 className="mb-3 text-base font-semibold">Items</h2>
            <ul className="flex flex-col gap-3">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{item.productName ?? "Item"}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku} · Qty {item.quantity}
                      {item.unitPrice ? ` · ${formatPrice(item.unitPrice)} each` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium">
                    {item.lineTotal ? formatPrice(item.lineTotal) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Addresses">
            <h2 className="mb-3 text-base font-semibold">Delivery details</h2>
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Shipping</p>
                <AddressBlock
                  name={`${shipping?.firstName ?? ""} ${shipping?.lastName ?? ""}`.trim()}
                  line1={shipping?.addressLine1}
                  city={shipping?.city}
                  state={shipping?.state}
                  postal={shipping?.postalCode}
                  country={shipping?.country}
                  phone={shipping?.phone}
                />
              </div>
              <div>
                <p className="font-medium">Billing</p>
                <AddressBlock
                  name={`${billing?.firstName ?? ""} ${billing?.lastName ?? ""}`.trim()}
                  line1={billing?.addressLine1}
                  city={billing?.city}
                  state={billing?.state}
                  postal={billing?.postalCode}
                  country={billing?.country}
                  phone={billing?.phone}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="History">
            <h2 className="mb-3 text-base font-semibold">Order history</h2>
            {order.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events recorded yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {order.history.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-2 text-sm">
                    <div>
                      <OrderStatusBadge status={event.status} />
                      {event.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>
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

        <aside className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10 lg:sticky lg:top-6">
          <h2 className="text-base font-semibold">Summary</h2>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatPrice(order.subtotal)}</dd>
            </div>
            {Number(order.discountAmount) > 0 ? (
              <div className="flex justify-between text-primary">
                <dt>Discounts</dt>
                <dd>−{formatPrice(order.discountAmount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd>{formatPrice(order.shippingAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tax</dt>
              <dd>{formatPrice(order.taxAmount)}</dd>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd>{formatPrice(order.totalAmount)} {order.currency}</dd>
            </div>
          </dl>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Payment</span>
            <span className="font-medium">
              {order.paymentMethod === "CASH_ON_DELIVERY" ? "Cash on delivery" : order.paymentMethod === "CARD" ? "Card" : "—"}
            </span>
          </div>

          {order.cancellable ? (
            <div className="flex flex-col gap-2">
              <CancelOrderButton orderId={order.id} />
              <p className="text-xs text-muted-foreground">
                Free cancellation while your order awaits payment.
              </p>
            </div>
          ) : order.paidBeyondCancel ? (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {order.status === "CANCELLED"
                ? "This order is cancelled."
                : "Self-service cancellation has closed for this order. Contact support if you need help — paid orders require a refund review."}
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function AddressBlock({
  name, line1, city, state, postal, country, phone,
}: {
  name: string;
  line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
  phone?: string | null;
}) {
  return (
    <address className="mt-1 text-xs not-italic text-muted-foreground">
      {name ? <span className="block text-sm font-medium text-foreground">{name}</span> : null}
      {line1 ? <span className="block">{line1}</span> : null}
      <span className="block">
        {[city, state, postal].filter(Boolean).join(", ")}
      </span>
      {country ? <span className="block">{country}</span> : null}
      {phone ? <span className="block">{phone}</span> : null}
    </address>
  );
}

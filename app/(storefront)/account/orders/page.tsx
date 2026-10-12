import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatPrice } from "@/shared/lib/utils";
import { formatDate } from "@/shared/lib/format";
import { getOrderHistoryAction } from "@/modules/orders/presentation/actions/order.actions";
import { OrderStatusBadge } from "@/modules/orders/presentation/components/order-status-badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your Orders — VELORA",
  description: "Review your order history.",
};

interface OrdersPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function CustomerOrdersPage({ searchParams }: OrdersPageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const res = await getOrderHistoryAction({ page, pageSize: 10 });

  if (!res.ok || !res.data) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <h1 className="text-2xl font-semibold">We couldn&apos;t load your orders</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            {res.ok ? "Please try again." : res.error}
          </p>
          <Button size="lg" render={<Link href="/account/orders">Retry</Link>} />
        </div>
      </main>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold">Your orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {totalCount} order{totalCount === 1 ? "" : "s"}
      </p>

      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-lg font-semibold tracking-[0.2em] text-primary">VELORA</p>
          <h2 className="text-xl font-semibold">No orders yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            When you check out, your orders will appear here with live status and history.
          </p>
          <Button size="lg" render={<Link href="/products">Start shopping</Link>} />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((order) => (
            <Link
              key={order.id}
              href={`/account/orders/${order.id}`}
              className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{order.orderNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(order.createdAt)} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <OrderStatusBadge status={order.status} />
                <OrderStatusBadge status={order.paymentStatus} kind="payment" />
                <span className="text-sm font-semibold">{formatPrice(order.totalAmount)}</span>
              </div>
            </Link>
          ))}

          {totalPages > 1 ? (
            <>
              <Separator />
              <nav className="flex items-center justify-between text-sm" aria-label="Order pages">
                {currentPage > 1 ? (
                  <Link className="underline underline-offset-4" href={`/account/orders?page=${currentPage - 1}`}>
                    ← Newer
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Link className="underline underline-offset-4" href={`/account/orders?page=${currentPage + 1}`}>
                    Older →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}

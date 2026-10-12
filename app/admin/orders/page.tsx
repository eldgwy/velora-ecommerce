import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatPrice } from "@/shared/lib/utils";
import { formatDate } from "@/shared/lib/format";
import { getAdminOrdersAction } from "@/modules/orders/presentation/actions/admin-order.actions";
import { OrderStatusBadge } from "@/modules/orders/presentation/components/order-status-badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orders — VELORA Admin",
};

const STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;

interface AdminOrdersPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? params.status
    : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const res = await getAdminOrdersAction({ status, page, pageSize: 20 });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load orders</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
      </div>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const pageHref = (p: number) =>
    `/admin/orders?${new URLSearchParams({
      ...(status ? { status } : {}),
      page: String(p),
    }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} order{totalCount === 1 ? "" : "s"} · fulfillment advances here, audited per action
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/orders">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" type="submit">
          Filter
        </Button>
        {status ? (
          <Button size="sm" variant="ghost" render={<Link href="/admin/orders">Clear</Link>} />
        ) : null}
      </form>

      {items.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">No orders match this filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-foreground/10">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Placed</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${order.id}`} className="font-medium underline underline-offset-4">
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(order.createdAt)}</td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.paymentStatus} kind="payment" />
                  </td>
                  <td className="px-4 py-3">{order.itemCount}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatPrice(order.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <>
          <Separator />
          <nav className="flex items-center justify-between text-sm" aria-label="Order pages">
            {currentPage > 1 ? (
              <Link className="underline underline-offset-4" href={pageHref(currentPage - 1)}>
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link className="underline underline-offset-4" href={pageHref(currentPage + 1)}>
                Older →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      ) : null}
    </div>
  );
}

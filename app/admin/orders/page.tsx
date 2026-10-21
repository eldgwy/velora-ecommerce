import { EmptyState } from "@/shared/components/ui/empty-state";

import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { getAdminOrdersAction } from "@/modules/orders/presentation/actions/admin-order.actions";
import { OrderBatchControls } from "@/modules/orders/presentation/components/order-batch-controls";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orders — VELORA Admin",
};

const STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const PAYMENT_STATUSES = [
  "PAID",
  "AUTHORIZED",
  "PENDING",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "REQUIRES_ACTION",
  "EXPIRED",
] as const;

interface AdminOrdersPageProps {
  searchParams: Promise<{
    status?: string;
    paymentStatus?: string;
    customer?: string;
    orderNumber?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? params.status
    : undefined;
  const paymentStatus = PAYMENT_STATUSES.includes(
    params.paymentStatus as (typeof PAYMENT_STATUSES)[number],
  )
    ? params.paymentStatus
    : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const res = await getAdminOrdersAction({
    status,
    paymentStatus,
    customer: params.customer || undefined,
    orderNumber: params.orderNumber || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    page,
    pageSize: 20,
  });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        </div>
      </div>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const kept = {
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(params.customer ? { customer: params.customer } : {}),
    ...(params.orderNumber ? { orderNumber: params.orderNumber } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  };
  const pageHref = (p: number) =>
    `/admin/orders?${new URLSearchParams({ ...kept, page: String(p) }).toString()}`;
  const hasFilters = Object.keys(kept).length > 0;

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
        <select
          name="paymentStatus"
          defaultValue={paymentStatus ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Filter by payment status"
        >
          <option value="">All payments</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          name="customer"
          defaultValue={params.customer ?? ""}
          placeholder="Customer name…"
          aria-label="Search by customer name"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          name="orderNumber"
          defaultValue={params.orderNumber ?? ""}
          placeholder="Order number…"
          aria-label="Search by order number"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          name="from"
          type="date"
          defaultValue={params.from ?? ""}
          aria-label="Placed from date"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          name="to"
          type="date"
          defaultValue={params.to ?? ""}
          aria-label="Placed to date"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <Button size="sm" variant="outline" type="submit">
          Filter
        </Button>
        {hasFilters ? (
          <Button size="sm" variant="ghost" render={<Link href="/admin/orders">Clear</Link>} />
        ) : null}
      </form>

      {items.length === 0 ? (
        <EmptyState title="No orders match this filter" />
      ) : (
        <OrderBatchControls orders={items} />
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

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatPrice } from "@/shared/lib/utils";
import { formatDate } from "@/shared/lib/format";
import { OrderStatusBadge } from "@/modules/orders/presentation/components/order-status-badge";
import { shipOrdersBatchAction } from "@/modules/orders/presentation/actions/admin-order.actions";
import type { OrderListItem } from "@/modules/orders/application/queries/orders";

/**
 * Fulfillment grid with selection: batch shipment (with an explicit
 * confirm step naming the count) and a manifest link for the selection.
 * Only PROCESSING rows are shippable; the server re-validates every id.
 */
export function OrderBatchControls({ orders }: { orders: OrderListItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- state Set, not drizzle
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const shipSelected = () => {
    const ids = [...selected];
    if (ids.length === 0 || ids.length > 50) return;
    startTransition(async () => {
      const res = await shipOrdersBatchAction({ orderIds: ids });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { succeeded, failed } = res.data!;
      if (succeeded.length > 0) toast.success(`${succeeded.length} order${succeeded.length === 1 ? "" : "s"} shipped.`);
      for (const f of failed) toast.error(`${f.orderId.slice(0, 8)}…: ${f.error}`);
      setSelected(new Set());
      setConfirming(false);
      router.refresh();
    });
  };

  const manifestHref =
    selected.size > 0
      ? `/admin/orders/manifest?${new URLSearchParams({ ids: [...selected].join(",") }).toString()}`
      : "#";

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 ring-1 ring-foreground/10">
          <span className="text-sm font-medium">{selected.size} selected (max 50)</span>
          {!confirming ? (
            <>
              <Button size="sm" disabled={pending} onClick={() => setConfirming(true)}>
                Ship selected…
              </Button>
              <Button size="sm" variant="outline" render={<Link href={manifestHref}>Print manifest</Link>} />
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                Ship {selected.size} order{selected.size === 1 ? "" : "s"}? Each is validated; ineligible rows report individually.
              </span>
              <Button size="sm" disabled={pending} onClick={shipSelected}>
                {pending ? <Spinner className="size-4" /> : null}
                Confirm shipment
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Back
              </Button>
            </>
          )}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-foreground/10">
        <table className="w-full min-w-[840px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium" aria-label="Select">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Placed</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    onChange={() => toggle(order.id)}
                    aria-label={`Select order ${order.orderNumber}`}
                    className="size-4"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/orders/${order.id}`} className="font-medium underline underline-offset-4">
                    {order.orderNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{order.customerName ?? "—"}</td>
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
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Separator } from "@/shared/components/ui/separator";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  cancelReturnItemAction,
  createReturnCaseAction,
  inspectReturnItemAction,
  receiveReturnItemAction,
  restockReturnItemAction,
} from "@/modules/returns/presentation/actions/return.actions";
import type { ReturnCaseView } from "@/modules/returns/application/queries/return-cases";
import type { RefundSummary } from "@/modules/payments/application/queries/refund-summary";

export interface ReturnOrderLine {
  id: string;
  productName: string | null;
  sku: string;
  quantity: number;
}

/**
 * Refund ledger + physical-return workflow for the admin order page.
 * Everything mutates through authorized server actions; the command layer
 * owns all business rules (quotas, inspection gates, restock idempotency).
 * Refunds never restock — stock moves only via an approved return line.
 */
export function AdminReturnControls({
  orderId,
  orderLines,
  cases,
  refundSummary,
}: {
  orderId: string;
  orderLines: ReturnOrderLine[];
  cases: ReturnCaseView[];
  refundSummary: RefundSummary | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const refresh = () => router.refresh();

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(label);
        refresh();
      } else {
        toast.error(res.error ?? "That action could not be completed.");
      }
    });
  };

  const openCase = () => {
    const items = Object.entries(quantities)
      .map(([orderItemId, raw]) => ({ orderItemId, quantity: Number(raw) }))
      .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
    if (items.length === 0) {
      toast.error("Enter a quantity for at least one line.");
      return;
    }
    if (reason.trim().length === 0) {
      toast.error("A return reason is required.");
      return;
    }
    run("Return case opened.", () =>
      createReturnCaseAction({ orderId, items, reason: reason.trim() }).then((r) => {
        if (r.ok) {
          setQuantities({});
          setReason("");
        }
        return r;
      }),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Refund ledger">
        <h3 className="text-sm font-semibold">Refunds</h3>
        {refundSummary ? (
          <div className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Captured</dt>
              <dd>
                {refundSummary.captured} {refundSummary.currency}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Refunded</dt>
              <dd>
                {refundSummary.refunded} {refundSummary.currency}
              </dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt className="text-muted-foreground">Remaining</dt>
              <dd>
                {refundSummary.remaining} {refundSummary.currency}
              </dd>
            </div>
            <p className="text-xs text-muted-foreground">
              Payment: {refundSummary.provider ?? "—"} · {refundSummary.paymentStatus ?? "—"}
            </p>
            {refundSummary.refunds.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1">
                {refundSummary.refunds.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground"
                  >
                    <span>
                      {r.amount} · {r.status}
                      {r.providerRefundId ? ` · ${r.providerRefundId.slice(0, 18)}…` : ""}
                    </span>
                    {r.reason ? <span className="italic">{r.reason.slice(0, 60)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No refunds recorded.</p>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No payment record for this order.</p>
        )}
      </section>

      <Separator />

      <section aria-label="Returns">
        <h3 className="text-sm font-semibold">Returns & restocking</h3>
        {cases.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No return cases. Opening one never moves money or stock.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {cases.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span className="font-medium">{c.status}</span>
                  <span className="text-muted-foreground">{c.reason.slice(0, 80)}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {c.items.map((item) => (
                    <li key={item.id} className="flex flex-col gap-1 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span>
                          Qty {item.quantity} · {item.status}
                          {item.condition ? ` · ${item.condition}` : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.status === "PENDING" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run("Receipt recorded.", () => receiveReturnItemAction(item.id))
                              }
                            >
                              Record receipt
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                run("Return line cancelled.", () => cancelReturnItemAction(item.id))
                              }
                            >
                              Cancel
                            </Button>
                          </>
                        ) : null}
                        {item.status === "RECEIVED" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run("Line approved.", () =>
                                  inspectReturnItemAction({
                                    itemId: item.id,
                                    approved: true,
                                    condition: "RESTOCKABLE",
                                  }),
                                )
                              }
                            >
                              Approve (restockable)
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run("Line rejected.", () =>
                                  inspectReturnItemAction({
                                    itemId: item.id,
                                    approved: false,
                                    condition: "DAMAGED",
                                  }),
                                )
                              }
                            >
                              Reject (damaged)
                            </Button>
                          </>
                        ) : null}
                        {item.status === "APPROVED" && item.condition === "RESTOCKABLE" ? (
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run("Goods restocked.", () => restockReturnItemAction(item.id))
                            }
                          >
                            {pending ? <Spinner className="size-4" /> : null}
                            Restock {item.quantity}
                          </Button>
                        ) : null}
                        {item.status === "RESTOCKED" ? (
                          <span className="text-muted-foreground">
                            Restocked · movement recorded
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium">Open a return case</p>
          {orderLines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-2 text-xs">
              <Label htmlFor={`return-qty-${line.id}`} className="min-w-0 flex-1 truncate">
                {line.productName ?? line.sku} · bought {line.quantity}
              </Label>
              <Input
                id={`return-qty-${line.id}`}
                className="h-8 w-20"
                inputMode="numeric"
                placeholder="Qty"
                value={quantities[line.id] ?? ""}
                onChange={(e) =>
                  setQuantities((q) => ({ ...q, [line.id]: e.target.value }))
                }
              />
            </div>
          ))}
          <div>
            <Label htmlFor="return-reason">Reason (recorded)</Label>
            <Textarea
              id="return-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer sent back size M for L"
              rows={2}
            />
          </div>
          <Button size="sm" variant="outline" disabled={pending} onClick={openCase}>
            {pending ? <Spinner className="size-4" /> : null}
            Open return case
          </Button>
          <p className="text-xs text-muted-foreground">
            Quantities can never exceed what was purchased, accounting for earlier cases. Stock
            moves only after receipt + restockable inspection + approval.
          </p>
        </div>
      </section>
    </div>
  );
}

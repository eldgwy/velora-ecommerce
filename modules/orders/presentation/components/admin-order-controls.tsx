"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import { Label } from "@/shared/components/ui/label";
import {
  cancelOrderAsStaffAction,
  deliverOrderAction,
  shipOrderAction,
} from "@/modules/orders/presentation/actions/admin-order.actions";
import { collectCodPaymentAction } from "@/modules/payments/presentation/actions/cod.actions";
import { AdminRefundControl } from "@/modules/orders/presentation/components/admin-refund-control";

/**
 * Staff fulfillment controls. Every control maps to one audited server
 * transition; permissions are enforced server-side, so hiding buttons here
 * is convenience only. A reason is mandatory for manual cancellation.
 */
export function AdminOrderControls({
  orderId,
  status,
  paymentStatus,
  paymentMethod,
}: {
  orderId: string;
  status: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  const run = (
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(label);
        router.refresh();
      } else {
        toast.error(res.error ?? "That action could not be completed.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Fulfillment</h2>
      {status === "PROCESSING" ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run("Order marked as shipped.", () => shipOrderAction(orderId))}
        >
          {pending ? <Spinner className="size-4" /> : null}
          Mark as shipped
        </Button>
      ) : null}
      {status === "SHIPPED" ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run("Order marked as delivered.", () => deliverOrderAction(orderId))}
        >
          {pending ? <Spinner className="size-4" /> : null}
          Mark as delivered
        </Button>
      ) : null}
      {status === "PENDING" || status === "PROCESSING" ? (
        showCancel ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="cancel-reason">Cancellation reason (recorded)</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer requested cancellation by phone"
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={pending || reason.trim().length === 0}
                onClick={() =>
                  run("Order cancelled.", () =>
                    cancelOrderAsStaffAction({ orderId, reason: reason.trim() }),
                  )
                }
              >
                {pending ? <Spinner className="size-4" /> : null}
                Confirm cancellation
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCancel(false)}>
                Back
              </Button>
            </div>
            {paymentStatus === "PAID" ? (
              <p className="text-xs text-muted-foreground">
                Paid orders keep their payment state on cancellation — refunds are handled through the refund
                workflow, never automatically here.
              </p>
            ) : paymentStatus === "REFUNDED" || paymentStatus === "PARTIALLY_REFUNDED" ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="note">
                This order has a refunded payment, so it cannot be cancelled here. Cancellation
                releases reserved stock — refunded orders re-enter stock only through the verified
                return workflow, so any cancellation request is settled as a refund or return
                instead.
              </p>
            ) : null}
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowCancel(true)}>
            Cancel order…
          </Button>
        )
      ) : null}
      {status !== "PENDING" && status !== "PROCESSING" && status !== "SHIPPED" ? (
        <p className="text-xs text-muted-foreground">No further transitions available.</p>
      ) : null}
      {paymentMethod === "CASH_ON_DELIVERY" &&
      paymentStatus === "PENDING" &&
      (status === "SHIPPED" || status === "DELIVERED") ? (
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run("Cash collection recorded.", () => collectCodPaymentAction(orderId))}
          >
            {pending ? <Spinner className="size-4" /> : null}
            Record cash collected
          </Button>
          <p className="text-xs text-muted-foreground">
            Cash on delivery is recorded here only — this never touches card processing.
          </p>
        </div>
      ) : null}
      {paymentStatus === "PAID" || paymentStatus === "PARTIALLY_REFUNDED" ? (
        <AdminRefundControl orderId={orderId} />
      ) : null}
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { cancelCustomerOrderAction } from "@/modules/orders/presentation/actions/order.actions";

/**
 * Self-service cancellation (BR-014). The server decides eligibility from
 * live state; this control only collects intent and surfaces the result.
 * Disabled while the request is in flight (UX), idempotent server-side.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onCancel = () => {
    startTransition(async () => {
      const res = await cancelCustomerOrderAction(orderId);
      if (res.ok) {
        toast.success("Your order was cancelled.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Button variant="destructive" size="sm" disabled={pending} onClick={onCancel}>
      {pending ? <Spinner className="size-4" /> : null}
      Cancel order
    </Button>
  );
}

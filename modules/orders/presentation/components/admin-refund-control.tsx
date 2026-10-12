"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import { requestRefundAction } from "@/modules/payments/presentation/actions/refund.actions";

/**
 * Staff refund control, shown for paid orders only. Amount is optional
 * (blank = remaining balance); every request needs a recorded reason.
 * Money moves only inside the server command via Stripe — this control
 * collects intent. Inventory is never restocked by refunds.
 */
export function AdminRefundControl({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const onRefund = () => {
    startTransition(async () => {
      const res = await requestRefundAction({
        orderId,
        amount: amount.trim() === "" ? undefined : amount.trim(),
        reason: reason.trim(),
      });
      if (res.ok && res.data) {
        toast.success(`Refund ${res.data.amount} issued (${res.data.status}).`);
        setAmount("");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.ok ? "Refund failed." : res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
      <p className="text-sm font-medium">Issue refund</p>
      <div>
        <Label htmlFor="refund-amount">Amount (optional, blank = full remaining)</Label>
        <Input
          id="refund-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="12.50"
          inputMode="decimal"
        />
      </div>
      <div>
        <Label htmlFor="refund-reason">Reason (recorded)</Label>
        <Textarea
          id="refund-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Damaged item, customer approved return"
          rows={2}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || reason.trim().length === 0}
        onClick={onRefund}
      >
        {pending ? <Spinner className="size-4" /> : null}
        Issue refund
      </Button>
      <p className="text-xs text-muted-foreground">
        Partial refunds allowed; cumulative refunds can never exceed the captured amount. Stock is
        never restocked automatically.
      </p>
    </div>
  );
}

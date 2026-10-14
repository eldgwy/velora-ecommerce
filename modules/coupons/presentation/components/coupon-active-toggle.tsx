"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { setCouponActiveAction } from "@/modules/coupons/presentation/actions/coupon-admin.actions";

/**
 * Activation toggle with explicit confirmation for deactivation.
 * Deactivation stops new redemptions immediately; past orders keep their
 * frozen discounts and are never touched.
 */
export function CouponActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const flip = (next: boolean) => {
    startTransition(async () => {
      const res = await setCouponActiveAction({ id, isActive: next });
      if (res.ok) {
        toast.success(next ? "Coupon activated." : "Coupon deactivated.");
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  if (!isActive) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => flip(true)}>
        {pending ? <Spinner className="size-4" /> : null}
        Activate
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Deactivate…
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Deactivation stops new redemptions at once. Existing orders are unaffected.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => flip(false)}>
          {pending ? <Spinner className="size-4" /> : null}
          Confirm deactivation
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

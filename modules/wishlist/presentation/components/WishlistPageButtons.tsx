"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  moveToCartAction,
  removeFromWishlistAction,
} from "@/modules/wishlist/presentation/actions/wishlist.actions";

function useWishlistMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; redirect?: string }>,
    successMessage: string,
  ) => {
    if (pending) return;
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        if (res.redirect) {
          router.push(res.redirect);
          return;
        }
        toast.error(res.error ?? "Something went wrong.");
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  };

  return { pending, run };
}

export function RemoveFromWishlistButton({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const { pending, run } = useWishlistMutation();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => run(() => removeFromWishlistAction({ productId }), "Removed from wishlist.")}
      aria-label={`Remove ${productName} from wishlist`}
    >
      {pending ? <Spinner className="size-4" /> : null}
      Remove
    </Button>
  );
}

export function MoveToCartButton({
  productId,
  disabled,
  disabledReason,
}: {
  productId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { pending, run } = useWishlistMutation();
  const isDisabled = pending || disabled;
  return (
    <span title={isDisabled ? (disabledReason ?? "Unavailable") : undefined}>
      <Button
        size="sm"
        disabled={isDisabled}
        onClick={() => run(() => moveToCartAction({ productId }), "Moved to your bag.")}
        aria-label="Move product to bag"
      >
        {pending ? <Spinner className="size-4" /> : null}
        Add to bag
      </Button>
    </span>
  );
}

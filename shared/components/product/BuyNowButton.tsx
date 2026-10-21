"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { addToCart } from "@/modules/cart/presentation/actions/cart.actions";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

interface BuyNowButtonProps {
  /** Server-verified variant id. Null disables the control. */
  variantId: string | null;
  disabled?: boolean;
  disabledLabel?: string;
  className?: string;
}

/**
 * Fast path to checkout ("Buy Now"): adds the selected variant through the
 * same cart server action as AddToCartButton (ownership, stock and price all
 * resolved server-side) and sends the user to /checkout instead of just
 * refreshing the page. If the cart cannot accept the item, the shared error
 * path surfaces the server message and stays put.
 */
export function BuyNowButton({
  variantId,
  disabled = false,
  disabledLabel,
  className,
}: BuyNowButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isDisabled = disabled || pending || variantId === null;

  const onClick = () => {
    if (pending || variantId === null) return;
    startTransition(async () => {
      const res = await addToCart({ variantId, quantity: 1 });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // /checkout is auth-gated; guests land on login?callbackUrl=/checkout
      // and the guest cart merges on sign-in.
      router.push("/checkout");
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={isDisabled}
      className={cn("h-11 w-full", className)}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Redirecting…
        </>
      ) : isDisabled && disabledLabel ? (
        disabledLabel
      ) : (
        "Buy Now"
      )}
    </Button>
  );
}

export default BuyNowButton;

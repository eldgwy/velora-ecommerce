"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { addToCart } from "@/modules/cart/presentation/actions/cart.actions";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

interface AddToCartButtonProps {
  /** Server-verified variant id. Null disables the control. */
  variantId: string | null;
  disabled?: boolean;
  disabledLabel?: string;
  className?: string;
}

/**
 * Purchase button backed by the existing cart server action. Ownership
 * (guest cookie vs session) is resolved entirely server-side; the client
 * only carries the variant identity and a quantity, matching the
 * add-item boundary contract (addCartItemSchema).
 */
export function AddToCartButton({
  variantId,
  disabled = false,
  disabledLabel,
  className,
}: AddToCartButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  const isDisabled = disabled || pending || variantId === null;

  const onClick = () => {
    if (pending || variantId === null) return;
    startTransition(async () => {
      const res = await addToCart({ variantId, quantity: 1 });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAdded(true);
      toast.success("Added to cart");
      router.refresh();
      window.setTimeout(() => setAdded(false), 2000);
    });
  };

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={cn("h-11 w-full", className)}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Adding…
        </>
      ) : added ? (
        <>
          <Check className="size-4" aria-hidden />
          Added
        </>
      ) : isDisabled && disabledLabel ? (
        disabledLabel
      ) : (
        "Add to Cart"
      )}
    </Button>
  );
}

export default AddToCartButton;

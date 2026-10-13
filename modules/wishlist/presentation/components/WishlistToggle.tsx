"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/utils";
import { toggleWishlistAction } from "@/modules/wishlist/presentation/actions/wishlist.actions";

interface WishlistToggleProps {
  productId: string;
  productName: string;
  initialSaved?: boolean;
  className?: string;
}

/**
 * Save/unsave toggle for product cards and detail pages. Single in-flight
 * request (rapid clicks can't desync state); guests are sent to sign in with
 * a return path. Renders as a real button for keyboard support.
 */
export function WishlistToggle({
  productId,
  productName,
  initialSaved = false,
  className,
}: WishlistToggleProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(initialSaved);

  const onToggle = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    startTransition(async () => {
      const res = await toggleWishlistAction({ productId });
      if (!res.ok) {
        if (res.redirect) {
          router.push(res.redirect);
          return;
        }
        toast.error(res.error);
        return;
      }
      setSaved(res.data?.saved ?? !saved);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${productName} from wishlist` : `Add ${productName} to wishlist`}
      className={cn(
        "flex size-8 items-center justify-center rounded-full border border-white/50 bg-white/75 text-foreground backdrop-blur-md transition-all duration-300 hover:scale-105 hover:bg-white hover:text-red-500 motion-reduce:transition-none disabled:opacity-60",
        saved && "border-red-200 bg-red-50 text-red-500",
        className,
      )}
    >
      <Heart className={cn("size-3.5", saved && "fill-current")} />
    </button>
  );
}

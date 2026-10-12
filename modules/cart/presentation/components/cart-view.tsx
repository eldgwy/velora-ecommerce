"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  getCartAction,
  removeCartItemAction,
  updateCartItem,
  validateCartAction,
} from "@/modules/cart/presentation/actions/cart.actions";
import type { CartDetail } from "@/modules/cart/application/queries/get-cart";
import type {
  CartValidationResult,
  MergeCartResult,
} from "@/modules/cart/domain/types";
import { CartItemRow } from "@/modules/cart/presentation/components/cart-item-row";
import { CartSummary } from "@/modules/cart/presentation/components/cart-summary";

interface CartViewProps {
  initialDetail: CartDetail;
  initialValidation: CartValidationResult;
  initialMerge: (MergeCartResult & { guestCartConsumed: boolean }) | null;
}

/**
 * Interactive cart page state. Every mutation round-trips through the server
 * actions and re-reads authoritative state — the client never computes
 * prices, totals, or availability.
 */
export function CartView({ initialDetail, initialValidation, initialMerge }: CartViewProps) {
  const [detail, setDetail] = useState<CartDetail>(initialDetail);
  const [validation, setValidation] = useState<CartValidationResult | null>(initialValidation);
  const [mergeNotice, setMergeNotice] = useState(initialMerge);
  const [refreshing, startRefresh] = useTransition();
  const [validating, startValidating] = useTransition();

  const refresh = useCallback(async () => {
    const [cartRes, valRes] = await Promise.all([getCartAction(), validateCartAction()]);
    if (cartRes.ok && cartRes.data) {
      setDetail(cartRes.data.detail);
      if (cartRes.data.merge) setMergeNotice(cartRes.data.merge);
    }
    if (valRes.ok && valRes.data) setValidation(valRes.data);
  }, []);

  const mutate = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<string | null> => {
      const res = await fn();
      if (!res.ok) return res.error ?? "We couldn't update your cart. Please try again.";
      await refresh();
      return null;
    },
    [refresh],
  );

  const handleUpdate = useCallback(
    (itemId: string, quantity: number) =>
      new Promise<string | null>((resolve) => {
        startRefresh(async () => {
          resolve(await mutate(() => updateCartItem({ itemId, quantity })));
        });
      }),
    [mutate],
  );

  const handleRemove = useCallback(
    (itemId: string) =>
      new Promise<string | null>((resolve) => {
        startRefresh(async () => {
          const error = await mutate(() => removeCartItemAction({ itemId }));
          if (!error) toast.success("Removed from your cart.");
          resolve(error);
        });
      }),
    [mutate],
  );

  const handleResolve = useCallback(
    async (action: { itemId: string; quantity: number } | { removeItemId: string }): Promise<string | null> => {
      if ("removeItemId" in action) return handleRemove(action.removeItemId);
      return handleUpdate(action.itemId, action.quantity);
    },
    [handleRemove, handleUpdate],
  );

  const handleRefreshValidation = useCallback(() => {
    startValidating(async () => {
      const res = await validateCartAction();
      if (res.ok && res.data) {
        setValidation(res.data);
        toast.success(res.data.valid ? "Your cart is ready for checkout." : "Validation updated — see issues below.");
      } else {
        toast.error("Could not recheck your cart. Please try again.");
      }
    });
  }, []);

  if (refreshing && detail.items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (detail.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
        <p className="text-lg font-semibold tracking-[0.2em] text-primary">VELORA</p>
        <h1 className="text-2xl font-semibold">Your bag is empty</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Discover pieces crafted to last — your selections will appear here,
          whether you are signed in or browsing as a guest.
        </p>
        <Button size="lg" render={<Link href="/products">Continue shopping</Link>} />
      </div>
    );
  }

  const mergedCount = mergeNotice?.mergedItems.length ?? 0;
  const adjustedCount = mergeNotice?.adjustedItems.length ?? 0;
  const unavailableCount =
    (mergeNotice?.unavailableItems.length ?? 0) + (mergeNotice?.invalidVariants.length ?? 0);

  return (
    <div className="flex flex-col gap-6">
      {mergeNotice && (mergedCount > 0 || adjustedCount > 0 || unavailableCount > 0) ? (
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Welcome back — your guest bag was merged</p>
            <Button variant="ghost" size="xs" onClick={() => setMergeNotice(null)}>
              Dismiss
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {mergedCount > 0 ? <Badge variant="secondary">{mergedCount} item(s) merged</Badge> : null}
            {adjustedCount > 0 ? (
              <Badge variant="outline">{adjustedCount} quantity(s) adjusted to available stock</Badge>
            ) : null}
            {unavailableCount > 0 ? (
              <Badge variant="destructive">{unavailableCount} item(s) need your attention</Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4" aria-busy={refreshing}>
          <h1 className="text-2xl font-semibold">
            Your bag{" "}
            <span className="text-base font-normal text-muted-foreground">
              ({detail.itemCount} item{detail.itemCount === 1 ? "" : "s"})
            </span>
          </h1>
          {detail.items.map((item) => (
            <CartItemRow key={item.id} item={item} onUpdate={handleUpdate} onRemove={handleRemove} />
          ))}
        </div>
        <CartSummary
          detail={detail}
          validation={validation}
          onResolve={handleResolve}
          onRefreshValidation={handleRefreshValidation}
          validating={validating}
        />
      </div>
    </div>
  );
}

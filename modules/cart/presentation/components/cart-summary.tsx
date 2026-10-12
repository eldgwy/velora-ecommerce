"use client";

import Link from "next/link";
import { useTransition } from "react";

import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Separator } from "@/shared/components/ui/separator";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatPrice } from "@/shared/lib/utils";
import type { CartDetail } from "@/modules/cart/application/queries/get-cart";
import type { CartValidationResult } from "@/modules/cart/domain/types";

interface CartSummaryProps {
  detail: CartDetail;
  validation: CartValidationResult | null;
  onResolve: (action: { itemId: string; quantity: number } | { removeItemId: string }) => Promise<string | null>;
  onRefreshValidation: () => void;
  validating: boolean;
}

/**
 * Order summary: server-calculated subtotal, promotion savings, payable
 * total, plus the pre-checkout validation summary with one-click conflict
 * resolution (accept capped quantity / remove unavailable item).
 */
export function CartSummary({ detail, validation, onResolve, onRefreshValidation, validating }: CartSummaryProps) {
  const [pending, startTransition] = useTransition();

  const actionable = (validation?.items ?? []).filter(
    (item) => !item.inStock || item.priceChanged,
  );

  return (
    <aside className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10 lg:sticky lg:top-6">
      <h2 className="text-base font-semibold">Order summary</h2>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="font-medium">{formatPrice(detail.subtotal)}</dd>
        </div>
        {Number(detail.discountTotal) > 0 ? (
          <div className="flex justify-between text-primary">
            <dt>Promotion savings</dt>
            <dd>−{formatPrice(detail.discountTotal)}</dd>
          </div>
        ) : null}
        <Separator />
        <div className="flex justify-between text-base font-semibold">
          <dt>Total</dt>
          <dd>{formatPrice(detail.subtotal)}</dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        Shipping and taxes are calculated at checkout. Prices and availability
        are rechecked before payment.
      </p>

      {validation && !validation.valid ? (
        <div className="flex flex-col gap-2 rounded-lg bg-destructive/5 p-3 ring-1 ring-destructive/20">
          <p className="text-sm font-semibold text-destructive">
            Needs attention before checkout
          </p>
          {actionable.map((item) => (
            <div key={item.id} className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{item.productName}</span>
              {item.warnings.map((w, i) => (
                <span key={i} className="text-muted-foreground">
                  {w.message}
                </span>
              ))}
              <div className="flex gap-2 pt-1">
                {!item.inStock && item.maxAvailable > 0 ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await onResolve({ itemId: item.id, quantity: item.maxAvailable });
                      })
                    }
                  >
                    {pending ? <Spinner className="size-3" /> : null}
                    Accept {item.maxAvailable}
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await onResolve({ removeItemId: item.id });
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {validation.errors
            .filter((e) => !e.itemId)
            .map((e, i) => (
              <Badge key={i} variant="destructive" className="w-fit">
                {e.message}
              </Badge>
            ))}
        </div>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        disabled={validating}
        onClick={onRefreshValidation}
      >
        {validating ? <Spinner className="size-4" /> : null}
        Recheck availability
      </Button>

      <Button
        size="lg"
        disabled={detail.items.length === 0 || (validation !== null && !validation.valid)}
        render={<Link href="/checkout">Proceed to checkout</Link>}
      />
    </aside>
  );
}

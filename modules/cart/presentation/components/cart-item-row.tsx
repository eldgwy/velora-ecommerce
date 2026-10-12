"use client";

import Image from "next/image";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatPrice } from "@/shared/lib/utils";
import type { CartDetailItem } from "@/modules/cart/application/queries/get-cart";

interface CartItemRowProps {
  item: CartDetailItem;
  onUpdate: (itemId: string, quantity: number) => Promise<string | null>;
  onRemove: (itemId: string) => Promise<string | null>;
}

/**
 * One cart line: image, name, live unit price + line total, quantity
 * stepper, remove action, and per-item availability warnings. All prices
 * rendered are server-calculated; controls only send ids + quantities.
 */
export function CartItemRow({ item, onUpdate, onRemove }: CartItemRowProps) {
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<string | null>) => {
    startTransition(async () => {
      const error = await fn();
      if (error) toast.error(error);
    });
  };

  const outOfStock = item.availableStock <= 0;
  const short = item.quantity > item.availableStock;
  const priceChanged =
    item.priceAtAddition !== null &&
    Number(item.priceAtAddition) !== Number(item.currentPrice);

  return (
    <div className="flex gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.productName}
            fill
            sizes="80px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            VELORA
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-card-foreground">
              {item.productName}
            </p>
            {item.sku ? (
              <p className="text-xs text-muted-foreground">SKU {item.sku}</p>
            ) : null}
          </div>
          <p className="shrink-0 text-sm font-semibold">
            {formatPrice(item.lineTotal)}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatPrice(item.effectivePrice)} each</span>
          {item.promotion ? (
            <Badge variant="secondary">Promo: {item.promotion.name}</Badge>
          ) : null}
          {priceChanged ? (
            <Badge variant="outline">
              Was {formatPrice(item.priceAtAddition ?? "0")}
            </Badge>
          ) : null}
        </div>

        {outOfStock ? (
          <Badge variant="destructive" className="w-fit">
            Out of stock
          </Badge>
        ) : short ? (
          <Badge variant="destructive" className="w-fit">
            Only {item.availableStock} available
          </Badge>
        ) : null}
        {!item.purchasable ? (
          <Badge variant="destructive" className="w-fit">
            No longer available
          </Badge>
        ) : null}

        <div className="mt-auto flex items-center justify-between pt-2">
          <div className="flex items-center gap-1" aria-label="Quantity controls">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={pending || item.quantity <= 1}
              onClick={() => run(() => onUpdate(item.id, item.quantity - 1))}
              aria-label="Decrease quantity"
            >
              −
            </Button>
            <span
              className="w-8 text-center text-sm font-medium"
              aria-live="polite"
              aria-label={`Quantity ${item.quantity}`}
            >
              {pending ? <Spinner className="mx-auto size-4" /> : item.quantity}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={pending || item.quantity >= item.availableStock}
              onClick={() => run(() => onUpdate(item.id, item.quantity + 1))}
              aria-label="Increase quantity"
            >
              +
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => onRemove(item.id))}
            aria-label={`Remove ${item.productName}`}
          >
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

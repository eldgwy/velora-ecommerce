"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatPrice } from "@/shared/lib/utils";
import { removeHistoryEntryAction } from "@/modules/recently-viewed/presentation/actions/history.actions";
import type { RecentViewItem } from "@/modules/recently-viewed/application/queries/history";

/** One history row: live catalog data, detail link, remove control. */
export function HistoryRow({
  item,
  onRemoved,
}: {
  item: RecentViewItem;
  onRemoved?: (productId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const purchasable = item.status === "ACTIVE";

  const remove = () => {
    if (pending) return;
    if (onRemoved) {
      onRemoved(item.productId);
      return;
    }
    startTransition(async () => {
      const res = await removeHistoryEntryAction({ productId: item.productId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="flex gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <Link
        href={`/products/${item.slug}`}
        className="relative block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-secondary"
        aria-label={`View ${item.productName}`}
      >
        {item.primaryImageUrl ? (
          // Cloudinary is allowlisted in images.remotePatterns.
          <Image
            src={item.primaryImageUrl}
            alt={item.primaryImageAlt ?? item.productName}
            fill
            sizes="80px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            VELORA
          </span>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/products/${item.slug}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {item.productName}
          </Link>
          <span className="shrink-0 text-sm font-semibold">{formatPrice(item.basePrice)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {purchasable ? "Available" : "Currently unavailable"}
        </p>
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={remove}
            aria-label={`Remove ${item.productName} from recently viewed`}
          >
            {pending ? <Spinner className="size-4" /> : null}
            Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Row list with heading; renders nothing when empty (no misleading section). */
export function HistoryRowList({
  items,
  heading,
  onRemoved,
}: {
  items: RecentViewItem[];
  heading: string;
  onRemoved?: (productId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{heading}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <HistoryRow key={item.productId} item={item} onRemoved={onRemoved} />
        ))}
      </ul>
    </section>
  );
}

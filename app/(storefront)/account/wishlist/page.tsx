import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatPrice } from "@/shared/lib/utils";
import { requireSession } from "@/shared/lib/guards";
import { getWishlistDetail } from "@/modules/wishlist/application/queries/wishlist";
import {
  MoveToCartButton,
  RemoveFromWishlistButton,
} from "@/modules/wishlist/presentation/components/WishlistPageButtons";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your Wishlist — VELORA",
  description: "Products you have saved for later.",
};

/**
 * Customer wishlist: live catalog data (price/availability always current),
 * snapshot-free. Saved prices are never promised — the page states that
 * availability and pricing may change.
 */
export default async function WishlistPage() {
  const session = await requireSession("/account/wishlist");
  const detail = await getWishlistDetail(session.user.id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold">Your wishlist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {detail.itemCount} saved item{detail.itemCount === 1 ? "" : "s"} · prices and
        availability are checked live and may change
      </p>

      {detail.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-lg font-semibold tracking-[0.2em] text-primary">VELORA</p>
          <h2 className="text-xl font-semibold">Nothing saved yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Tap the heart on any product to keep it here for later.
          </p>
          <Button size="lg" render={<Link href="/products">Browse products</Link>} />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {detail.items.map((item) => {
            const purchasable = item.status === "ACTIVE";
            return (
              <li
                key={item.itemId}
                className="flex gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
              >
                <Link
                  href={`/products/${item.slug}`}
                  className="relative block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-secondary"
                  aria-label={`View ${item.productName}`}
                >
                  {item.primaryImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.primaryImageUrl}
                      alt={item.primaryImageAlt ?? item.productName}
                      className="h-full w-full object-cover"
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
                    <span className="shrink-0 text-sm font-semibold">
                      {formatPrice(item.basePrice)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {purchasable ? "Available" : "Currently unavailable"}
                  </p>
                  <div className="mt-auto flex items-center gap-2 pt-2">
                    <MoveToCartButton
                      productId={item.productId}
                      disabled={!purchasable}
                      disabledReason="This product is currently unavailable"
                    />
                    <RemoveFromWishlistButton
                      productId={item.productId}
                      productName={item.productName}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Separator className="my-6" />
      <p className="text-xs text-muted-foreground">
        Saving a product does not reserve it or lock its price.
      </p>
    </main>
  );
}

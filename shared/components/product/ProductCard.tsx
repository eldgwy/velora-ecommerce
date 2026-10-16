import Link from "next/link";

import { fromMinorUnits } from "@/modules/checkout/domain/money";
import { WishlistToggle } from "@/modules/wishlist/presentation/components/WishlistToggle";

export interface ProductCardProduct {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  comparePrice: string | null;
  minVariantPrice: string | null;
  primaryImage: { url: string; alt: string | null } | null;
  brand: { name: string } | null;
  averageRating: number | null;
  reviewCount: number;
}

export interface ProductCardPromotion {
  minEffectiveCents: number | null;
  hasDiscount: boolean;
  promotionName: string | null;
}

function formatPrice(price: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(price));
}

/**
 * Shared storefront product card: image, rating, name, effective "from"
 * price with strikethrough + sale badge, wishlist toggle. All figures
 * arrive precomputed — no pricing logic lives here.
 */
export function ProductCard({
  product,
  initialSaved,
  promotion,
}: {
  product: ProductCardProduct;
  initialSaved: boolean;
  promotion?: ProductCardPromotion | null;
}) {
  const listFrom = product.minVariantPrice ?? product.basePrice;
  // Effective "from" price; struck-through only when actually lower.
  const promoFrom =
    promotion?.hasDiscount && promotion.minEffectiveCents !== null
      ? fromMinorUnits(promotion.minEffectiveCents, "USD")
      : null;
  const showPromo = promoFrom !== null && Number(promoFrom) < Number(listFrom);
  return (
    <div className="group relative">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="aspect-square relative overflow-hidden rounded-lg bg-muted">
          {product.primaryImage ? (
            // Remote catalog imagery (same pattern as the product pages).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.primaryImage.url}
              alt={product.primaryImage.alt ?? product.name}
              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">No Image</div>
          )}
          {product.averageRating && product.reviewCount > 0 && (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs font-medium">
              <span className="text-amber-500">★</span>
              <span>{product.averageRating.toFixed(1)}</span>
              <span className="text-muted-foreground">({product.reviewCount})</span>
            </div>
          )}
        </div>
        <div className="mt-3 space-y-1">
          <h3 className="font-medium line-clamp-1 group-hover:text-primary transition-colors">{product.name}</h3>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{formatPrice(showPromo ? promoFrom! : listFrom)}</span>
            {showPromo ? (
              <span className="text-sm line-through text-muted-foreground">{formatPrice(listFrom)}</span>
            ) : null}
            {showPromo ? (
              <span
                className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium"
                title={promotion?.promotionName ?? undefined}
              >
                Sale
              </span>
            ) : null}
            {product.comparePrice && Number(product.comparePrice) > Number(product.basePrice) && (
              <span className="text-sm line-through text-muted-foreground">{formatPrice(product.comparePrice)}</span>
            )}
          </div>
          {product.brand && (
            <span className="text-xs text-muted-foreground">{product.brand.name}</span>
          )}
        </div>
      </Link>
      <WishlistToggle
        productId={product.id}
        productName={product.name}
        initialSaved={initialSaved}
        className="absolute left-2 top-2"
      />
    </div>
  );
}

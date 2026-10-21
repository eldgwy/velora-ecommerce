import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductBySlug, getProductReviews } from "@/services/catalog-public";
import { ProductReviewSection } from "@/modules/reviews/presentation/components/review-section";
import { ProductQuestionSection } from "@/modules/product-questions/presentation/components/question-section";
import { RecordProductView } from "@/modules/recently-viewed/presentation/components/record-view";
import { RecentViewsSection } from "@/modules/recently-viewed/presentation/components/recent-views-section";
import { GuestRecentViews } from "@/modules/recently-viewed/presentation/components/guest-recent-views";
import { getVariantPromotionViews } from "@/modules/promotions/application/queries/promotion-pricing";
import { fromMinorUnits, toMinorUnits } from "@/modules/checkout/domain/money";
import Link from "next/link";
import VariantSelector from "@/shared/components/product/VariantSelector";
import { ProductGallery } from "@/shared/components/product/ProductGallery";
import { PromotionPrice } from "@/shared/components/product/PromotionPrice";
import { WishlistToggle } from "@/modules/wishlist/presentation/components/WishlistToggle";
import { getSavedProductIds } from "@/modules/wishlist/application/queries/wishlist";
import { getCurrentSession } from "@/shared/lib/guards";
import { formatPrice } from "@/shared/lib/utils";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ reviewsPage?: string; questionsPage?: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product Not Found" };
  return {
    title: product.name,
    description: product.description ?? undefined,
    // Legacy product-UUID URLs declare the slug URL as canonical (GP-29):
    // crawlers index one deterministic address per product.
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      description: product.description ?? undefined,
      images: product.images.filter((i) => i.isPrimary).map((i) => i.url),
    },
  };
}

async function ProductContent({ params, searchParams }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const search = (await searchParams) ?? {};
  const reviewsPage = Math.max(1, parseInt(search.reviewsPage ?? "1", 10) || 1);
  const questionsPage = Math.max(1, parseInt(search.questionsPage ?? "1", 10) || 1);


  // Fetch reviews
  const reviewsResult = await getProductReviews(product.id);

  // Wishlist state for the toggle (guests see unsaved; toggle prompts sign-in).
  const session = await getCurrentSession();
  const savedIds = session
    ? await getSavedProductIds(session.user.id, [product.id])
    : new Set<string>();

  // Authoritative promotion views, batched per product (never per variant).
  // Display-only: checkout revalidates and charges from the same rules.
  const promoViews = await getVariantPromotionViews(
    product.variants.map((v) => ({
      variantId: v.id,
      productId: product.id,
      listPrice: v.priceOverride ?? product.basePrice,
      purchasable: v.status === "ACTIVE" && product.status === "ACTIVE",
    })),
  );
  const discounted = [...promoViews.values()].filter((v) => v.savingCents > 0);
  const bestView =
    discounted.length > 0
      ? discounted.reduce((a, b) => (b.effectiveCents < a.effectiveCents ? b : a))
      : null;
  const selectorViews: Record<
    string,
    { effectivePrice: string; listPrice: string; promotionName: string | null; endsAt: string | null }
  > = {};
  for (const [variantId, view] of promoViews) {
    selectorViews[variantId] = {
      effectivePrice: fromMinorUnits(view.effectiveCents, "USD"),
      listPrice: fromMinorUnits(view.listPriceCents, "USD"),
      promotionName: view.promotionName,
      endsAt: view.promotionEndsAt ? view.promotionEndsAt.toISOString() : null,
    };
  }

  // GP-29: Product JSON-LD, composed strictly from data already resolved
  // for this render (no extra reads, no invented values). Prices are the
  // same effective promotion prices shown in the selector; availability
  // reflects the product's ACTIVE variants and their live stock windows.
  const purchasableVariants = product.variants.filter((v) => v.status === "ACTIVE");
  const effectivePrices = purchasableVariants.map(
    (v) => promoViews.get(v.id)?.effectiveCents ?? toMinorUnits(v.priceOverride ?? product.basePrice, "USD"),
  );
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    image: product.images.map((i) => i.url),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
    ...(reviewsResult.reviewCount > 0 && reviewsResult.averageRating !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: reviewsResult.averageRating,
            reviewCount: reviewsResult.reviewCount,
          },
        }
      : {}),
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      ...(effectivePrices.length > 0
        ? { lowPrice: Math.min(...effectivePrices), highPrice: Math.max(...effectivePrices) }
        : {}),
      ...(purchasableVariants.length > 0
        ? {
            offerCount: purchasableVariants.length,
            availability: purchasableVariants.some((v) => v.availableStock > 0)
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          }
        : { availability: "https://schema.org/Discontinued" }),
    },
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <script
        type="application/ld+json"
        // Static object of server-resolved primitives; `<` is escaped so a
        // description cannot close the script tag early (JSON-LD hygiene).
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      {/* Breadcrumb */}
      <nav className="mb-6" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li><Link href="/" className="hover:underline">Home</Link></li>
          <li><Link href="/products" className="hover:underline">Products</Link></li>
          <li aria-current="page">{product.name}</li>
        </ol>
      </nav>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Product Gallery */}
        <section className="space-y-4">
          <ProductGallery images={product.images} productName={product.name} />
        </section>

        {/* Product Info */}
        <section className="space-y-6">
          {product.brand && (
            <Link href={`/products?brand=${product.brand.slug}`} className="text-sm text-muted-foreground hover:text-primary">
              {product.brand.name}
            </Link>
          )}

          <h1 className="text-3xl font-bold tracking-tight">{product.name}</h1>

          {/* Rating Summary */}
          {reviewsResult.averageRating !== null && reviewsResult.reviewCount > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-2xl font-bold text-amber-500">{reviewsResult.averageRating.toFixed(1)}</span>
                <span className="text-amber-500">★</span>
              </div>
              <span className="text-sm text-muted-foreground">
                ({reviewsResult.reviewCount} review{reviewsResult.reviewCount !== 1 ? "s" : ""})
              </span>
            </div>
          )}

          <div className="flex items-center gap-4">
            {bestView ? (
              <PromotionPrice
                listPrice={fromMinorUnits(bestView.listPriceCents, "USD")}
                effectivePrice={fromMinorUnits(bestView.effectiveCents, "USD")}
                promotionName={bestView.promotionName}
                endsAt={bestView.promotionEndsAt?.toISOString() ?? null}
                size="lg"
                badgeLabel={bestView.promotionName ?? "Sale"}
              />
            ) : (
              <span className="text-3xl font-bold">{formatPrice(product.basePrice)}</span>
            )}
            {product.comparePrice && Number(product.comparePrice) > Number(product.basePrice) && (
              <span className="text-xl line-through text-muted-foreground">{formatPrice(product.comparePrice)}</span>
            )}
          </div>

          {product.description && (
            <div className="prose prose-muted max-w-none">
              <p>{product.description}</p>
            </div>
          )}

          {/* Variant selection + purchase actions. Always rendered: the
              selector itself shows the honest state — a simple product
              without variant rows (nothing purchasable yet) displays a
              disabled control instead of hiding the area entirely. */}
          <VariantSelector key={product.id} product={product} promotionViews={selectorViews} />

          {/* Purchase actions live inside VariantSelector (optioned and
              simple products); wishlist stays alongside. */}
          <div className="flex items-center gap-4 pt-4 border-t">
            <WishlistToggle
              productId={product.id}
              productName={product.name}
              initialSaved={savedIds.has(product.id)}
              className="size-11 shrink-0 !rounded-lg"
            />
            <span className="text-sm text-muted-foreground">
              Save to wishlist
            </span>
          </div>

          {/* Product Options Info */}
          {product.options.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="font-semibold mb-3">Options</h3>
              <dl className="space-y-2 text-sm">
                {product.options.map((option) => (
                  <div key={option.id} className="flex justify-between">
                    <dt className="text-muted-foreground">{option.name}:</dt>
                    <dd className="font-medium">
                      {option.values.map((v) => v.value).join(", ")}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      </div>

      {/* Detail sections (description already shown above; reviews and Q&A below) */}
      <div className="mt-12 border-t">
        <div className="py-6 prose prose-muted max-w-none">
          <p>{product.description ?? "No description available."}</p>
        </div>

        <div className="py-6 border-t">
          <ProductReviewSection
            productId={product.id}
            signedIn={session !== null}
            page={reviewsPage}
          />
        </div>

        <div className="py-6 border-t">
          <ProductQuestionSection
            productId={product.id}
            signedIn={session !== null}
            page={questionsPage}
          />
        </div>

        <div className="py-6 border-t">
          <RecordProductView productId={product.id} signedIn={session !== null} />
          {session ? (
            <RecentViewsSection userId={session.user.id} currentProductId={product.id} />
          ) : (
            <GuestRecentViews currentProductId={product.id} />
          )}
        </div>

        {/* Reviews Section */}
        {reviewsResult.reviews.length > 0 && (
          <div className="py-6 border-t">
            <h3 className="text-xl font-semibold mb-6">Customer Reviews</h3>
            <div className="space-y-6">
              {reviewsResult.reviews.map((review) => (
                <article key={review.id} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-amber-500">
                      {Array.from({ length: 5 }, (_, i) => (
                        <span key={i} className={i < (review.rating ?? 0) ? "fill-current" : ""}>
                          <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        </span>
                      ))}
                    </div>
                    <span className="font-medium">{review.userName ?? "Verified Buyer"}</span>
                    <span className="text-sm text-muted-foreground">{review.createdAt}</span>
                  </div>
                  {review.title && <h4 className="font-medium">{review.title}</h4>}
                  <p className="text-muted-foreground">{review.content}</p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductContent;
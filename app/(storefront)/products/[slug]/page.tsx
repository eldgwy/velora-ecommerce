import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductBySlug, getProductReviews } from "@/services/catalog-public";
import Link from "next/link";
import VariantSelector from "@/shared/components/product/VariantSelector";
import { formatPrice } from "@/shared/lib/utils";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product Not Found" };
  return {
    title: product.name,
    description: product.description ?? undefined,
    openGraph: {
      title: product.name,
      description: product.description ?? undefined,
      images: product.images.filter((i) => i.isPrimary).map((i) => i.url),
    },
  };
}

async function ProductContent({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const primaryImage = product.images.find((i) => i.isPrimary) ?? product.images[0];

  // Fetch reviews
  const reviewsResult = await getProductReviews(product.id);

  return (
    <div className="container mx-auto px-4 py-8">
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
          <div className="aspect-square rounded-lg overflow-hidden bg-muted">
            {primaryImage ? (
              <img
                src={primaryImage.url}
                alt={primaryImage.alt ?? product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">No Image</div>
            )}
          </div>

          {product.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {product.images.map((image) => (
                <button
                  key={image.id}
                  className={`flex-shrink-0 aspect-square w-20 rounded overflow-hidden border-2 transition-colors ${
                    image.isPrimary ? "border-primary" : "border-transparent hover:border-accent"
                  }`}
                  onClick={() => {
                    // In a real implementation, this would update the main image
                    console.log("Select image:", image.id);
                  }}
                >
                  <img src={image.url} alt={image.alt ?? ""} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
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
            <span className="text-3xl font-bold">{formatPrice(product.basePrice)}</span>
            {product.comparePrice && Number(product.comparePrice) > Number(product.basePrice) && (
              <span className="text-xl line-through text-muted-foreground">{formatPrice(product.comparePrice)}</span>
            )}
          </div>

          {product.description && (
            <div className="prose prose-muted max-w-none">
              <p>{product.description}</p>
            </div>
          )}

          {/* Variant Selection */}
          {product.variants.length > 0 && (
            <VariantSelector key={product.id} product={product} />
          )}

          {/* Add to Cart */}
          <div className="flex gap-4 pt-4 border-t">
            <button className="flex-1 btn btn-primary btn-lg">Add to Cart</button>
            <button className="btn btn-outline btn-lg" aria-label="Add to wishlist">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
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

      {/* Tabs for Description, Specs, Reviews */}
      <div className="mt-12 border-t">
        <nav className="flex gap-6 border-b" aria-label="Product tabs">
          <button className="pb-3 font-medium text-primary border-b-2 border-primary">Description</button>
          <button className="pb-3 font-medium text-muted-foreground hover:text-foreground">Specifications</button>
          <button className="pb-3 font-medium text-muted-foreground hover:text-foreground">Reviews ({reviewsResult.reviewCount})</button>
        </nav>
        <div className="py-6 prose prose-muted max-w-none">
          <p>{product.description ?? "No description available."}</p>
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
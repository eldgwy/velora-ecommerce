import { Metadata } from "next";
import { searchProducts, getActiveBrands, getCategoryTree } from "@/services/catalog-public";
import Link from "next/link";
import { getCurrentSession } from "@/shared/lib/guards";
import { getSavedProductIds } from "@/modules/wishlist/application/queries/wishlist";
import { WishlistToggle } from "@/modules/wishlist/presentation/components/WishlistToggle";

interface ProductsPageProps {
  searchParams: Promise<{
    category?: string;
    brand?: string;
    minPrice?: string;
    maxPrice?: string;
    inStock?: string;
    rating?: string;
    sort?: string;
    page?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "All Products",
    description: "Browse our complete product catalog",
  };
}

async function ProductsContent({ searchParams }: ProductsPageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));

  const filters = {
    categorySlug: params.category,
    brandSlug: params.brand,
    minPrice: params.minPrice ? parseFloat(params.minPrice) : undefined,
    maxPrice: params.maxPrice ? parseFloat(params.maxPrice) : undefined,
    inStockOnly: params.inStock === "true",
    rating: params.rating ? parseInt(params.rating, 10) : undefined,
    sort: (params.sort as "price_asc" | "price_desc" | "newest" | "rating") ?? "newest",
    page,
    pageSize: 24,
  };

  const [productsResult, brands, categories] = await Promise.all([
    searchProducts(filters),
    getActiveBrands(),
    getCategoryTree(true),
  ]);

  // One batched membership query for the whole grid (no per-card queries).
  const session = await getCurrentSession();
  const savedIds = session
    ? await getSavedProductIds(
        session.user.id,
        productsResult.items.map((p) => p.id),
      )
    : new Set<string>();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex gap-8">
        {/* Sidebar Filters */}
        <aside className="w-64 flex-shrink-0 space-y-6" aria-label="Product filters">
          {/* Categories */}
          <section>
            <h3 className="font-semibold mb-3">Categories</h3>
            <nav className="space-y-1">
              <Link
                href="/products"
                className={`block px-2 py-1 rounded text-sm ${!params.category ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                All Categories
              </Link>
              {categories.map((cat) => (
                <CategoryFilterLink key={cat.id} category={cat} selected={params.category} level={0} />
              ))}
            </nav>
          </section>

          {/* Brands */}
          <section>
            <h3 className="font-semibold mb-3">Brands</h3>
            <nav className="space-y-1 max-h-64 overflow-y-auto">
              <Link
                href="/products"
                className={`block px-2 py-1 rounded text-sm ${!params.brand ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                All Brands
              </Link>
              {brands.map((brand) => (
                <Link
                  key={brand.id}
                  href={`/products?brand=${brand.slug}${params.category ? `&category=${params.category}` : ""}`}
                  className={`block px-2 py-1 rounded text-sm ${params.brand === brand.slug ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                >
                  {brand.name}
                </Link>
              ))}
            </nav>
          </section>

          {/* Price Range */}
          <section>
            <h3 className="font-semibold mb-3">Price Range</h3>
            <form className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  name="minPrice"
                  placeholder="Min"
                  value={params.minPrice ?? ""}
                  className="input input-sm"
                  step="0.01"
                  min="0"
                />
                <input
                  type="number"
                  name="maxPrice"
                  placeholder="Max"
                  value={params.maxPrice ?? ""}
                  className="input input-sm"
                  step="0.01"
                  min="0"
                />
              </div>
              <button type="submit" className="btn btn-sm btn-primary w-full">Apply</button>
            </form>
          </section>

          {/* In Stock */}
          <section>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="inStock"
                checked={params.inStock === "true"}
                onChange={(e) => {
                  const url = new URL(window.location.href);
                  if (e.target.checked) url.searchParams.set("inStock", "true");
                  else url.searchParams.delete("inStock");
                  url.searchParams.delete("page");
                  window.location.href = url.toString();
                }}
                className="checkbox"
              />
              <span className="text-sm">In Stock Only</span>
            </label>
          </section>

          {/* Rating Filter */}
          <section>
            <h3 className="font-semibold mb-3">Rating</h3>
            <div className="space-y-1">
              {[4, 3, 2, 1].map((stars) => (
                <label key={stars} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="rating"
                    value={String(stars)}
                    checked={params.rating === String(stars)}
                    onChange={(e) => {
                      const url = new URL(window.location.href);
                      if (e.target.checked) url.searchParams.set("rating", e.target.value);
                      else url.searchParams.delete("rating");
                      url.searchParams.delete("page");
                      window.location.href = url.toString();
                    }}
                    className="radio"
                  />
                  <span className="text-sm flex items-center gap-1">
                    {"★".repeat(stars)}{"☆".repeat(5 - stars)}
                    <span className="text-muted-foreground"> & Up</span>
                  </span>
                </label>
              ))}
              <Link
                href="/products"
                className="block text-sm text-muted-foreground hover:text-foreground"
              >
                Clear Rating
              </Link>
            </div>
          </section>
        </aside>

        {/* Product Grid */}
        <main className="flex-1 min-w-0">
          {/* Sort & Results Count */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <p className="text-sm text-muted-foreground">
              Showing {productsResult.items.length} of {productsResult.totalCount} products
            </p>
            <select
              value={filters.sort}
              onChange={(e) => {
                const url = new URL(window.location.href);
                url.searchParams.set("sort", e.target.value);
                url.searchParams.delete("page");
                window.location.href = url.toString();
              }}
              className="select select-sm w-auto"
              aria-label="Sort products"
            >
              <option value="newest">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
            </select>
          </div>

          {/* Product Grid */}
          {productsResult.items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No products found matching your criteria.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {productsResult.items.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  initialSaved={savedIds.has(product.id)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {productsResult.totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
              {page > 1 && (
                <Link
                  href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([k]) => k !== "page")), page: String(page - 1) }).toString()}`}
                  className="btn btn-outline btn-sm"
                >
                  Previous
                </Link>
              )}
              <span className="px-4 text-sm text-muted-foreground">
                Page {page} of {productsResult.totalPages}
              </span>
              {page < productsResult.totalPages && (
                <Link
                  href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([k]) => k !== "page")), page: String(page + 1) }).toString()}`}
                  className="btn btn-outline btn-sm"
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </main>
      </div>
    </div>
  );
}

function CategoryFilterLink({
  category,
  selected,
  level = 0,
}: {
  category: Awaited<ReturnType<typeof getCategoryTree>>[0];
  selected?: string;
  level: number;
}) {
  const isSelected = selected === category.slug;
  const hasChildren = category.children.length > 0;

  return (
    <div className="pl-4" style={{ paddingLeft: `${level * 16 + 8}px` }}>
      <Link
        href={`/products?category=${category.slug}`}
        className={`block px-2 py-1 rounded text-sm ${isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-accent"}`}
      >
        {category.name}
      </Link>
      {hasChildren && (
        <nav className="space-y-1 mt-1">
          {category.children.map((child) => (
            <CategoryFilterLink key={child.id} category={child} selected={selected} level={level + 1} />
          ))}
        </nav>
      )}
    </div>
  );
}

function ProductCard({
  product,
  initialSaved,
}: {
  product: Awaited<ReturnType<typeof searchProducts>>["items"][0];
  initialSaved: boolean;
}) {
  return (
    <div className="group relative">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="aspect-square relative overflow-hidden rounded-lg bg-muted">
          {product.primaryImage ? (
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
            <span className="text-lg font-semibold">{formatPrice(product.minVariantPrice ?? product.basePrice)}</span>
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

function formatPrice(price: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(price));
}

export default ProductsContent;
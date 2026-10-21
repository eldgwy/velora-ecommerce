import { Metadata } from "next";
import Image from "next/image";
import { searchProducts, getSearchFacets, getActiveBrands, getCategoryTree } from "@/services/catalog-public";
import {
  InStockCheckbox,
  RatingFilter,
  SortSelect,
} from "@/shared/components/product/CatalogFilterControls";
import Link from "next/link";
import { Input } from "@/shared/components/ui/input";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { buildFilterHref } from "@/shared/lib/filter-links";
import { formatPrice } from "@/shared/lib/utils";
import { formatUsdInDisplayCurrency } from "@/shared/lib/currency-display";
import { buildDisplayCurrencyProps } from "@/shared/lib/currency-display-server";
import type { CardDisplayCurrency } from "@/shared/components/product/ProductCard";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
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

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const query = params.q?.trim();
  return {
    title: query ? `Search: "${query}"` : "Search Products",
    description: query ? `Search results for "${query}"` : "Search VELORA products",
  };
}

async function SearchContent({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const display = await buildDisplayCurrencyProps();
  const page = Math.max(1, parseInt(params.page ?? "1", 10));

  const filters = {
    query: params.q,
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

  const [productsResult, brands, categories, facets] = await Promise.all([
    searchProducts(filters),
    getActiveBrands(),
    getCategoryTree(true),
    getSearchFacets(filters),
  ]);

  const query = params.q?.trim() ?? "";

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Search Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          {query ? `Search Results for "${query}"` : "Search Products"}
        </h1>
        {query && (
          <p className="text-muted-foreground">
            Found {productsResult.totalCount} product{productsResult.totalCount !== 1 ? "s" : ""}
          </p>
        )}
      </header>

      <div className="flex gap-8">
        {/* Sidebar Filters */}
        <aside className="w-64 flex-shrink-0 space-y-6" aria-label="Product filters">
          {/* Search Input */}
          <section>
            <form className="space-y-2">
              <label htmlFor="search-input" className="sr-only">
                Search products
              </label>
              <Input
                id="search-input"
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search products..."
                className="w-full"
                autoComplete="off"
              />
            </form>
          </section>

          {/* Categories */}
          <section>
            <h3 className="font-semibold mb-3">Categories</h3>
            <nav className="space-y-1">
              <Link
                href={buildFilterHref("/search", { ...params }, { category: undefined })}
                className={`block px-2 py-1 rounded text-sm ${!params.category ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                All Categories
              </Link>
              {categories.map((cat) => (
                <CategoryFilterLink
                  key={cat.id}
                  category={cat}
                  selected={params.category}
                  level={0}
                  currentParams={{ ...params }}
                  counts={facets.categoryCounts}
                />
              ))}
            </nav>
          </section>

          {/* Brands */}
          <section>
            <h3 className="font-semibold mb-3">Brands</h3>
            <nav className="space-y-1 max-h-64 overflow-y-auto">
              <Link
                href={buildFilterHref("/search", { ...params }, { brand: undefined })}
                className={`block px-2 py-1 rounded text-sm ${!params.brand ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                All Brands
              </Link>
              {brands.map((brand) => {
                const brandCount = facets.brandCounts[brand.id];
                return (
                  <Link
                    key={brand.id}
                    href={buildFilterHref("/search", { ...params, q: query || undefined }, { brand: brand.slug })}
                    className={`flex items-center justify-between gap-2 px-2 py-1 rounded text-sm ${params.brand === brand.slug ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  >
                    <span>{brand.name}</span>
                    {brandCount ? (
                      <span className="text-xs text-muted-foreground">({brandCount})</span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </section>

          {/* Price Range */}
          <section>
            <h3 className="font-semibold mb-3">Price Range</h3>
            <form className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  name="minPrice"
                  placeholder="Min"
                  defaultValue={params.minPrice ?? ""}
                  step="0.01"
                  min="0"
                />
                <Input
                  type="number"
                  name="maxPrice"
                  placeholder="Max"
                  defaultValue={params.maxPrice ?? ""}
                  step="0.01"
                  min="0"
                />
              </div>
              {facets.priceBounds.min !== null || facets.priceBounds.max !== null ? (
                <p className="text-xs text-muted-foreground">
                  Matched: {formatPrice(facets.priceBounds.min ?? "0")} – {formatPrice(facets.priceBounds.max ?? "0")}
                </p>
              ) : null}
              <Button type="submit" size="sm" className="w-full">Apply</Button>
            </form>
          </section>

          {/* In Stock */}
          <section>
            <InStockCheckbox checked={params.inStock === "true"} count={facets.inStockCount} />
          </section>

          {/* Rating Filter */}
          <section>
            <h3 className="font-semibold mb-3">Rating</h3>
            <RatingFilter
              selected={params.rating}
              bandCounts={facets.ratingBands}
            />
            <Link
              href={`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`}
                className="block text-sm text-muted-foreground hover:text-foreground"
              >
                Clear Rating
              </Link>
          </section>
        </aside>

        {/* Product Grid */}
        <main className="flex-1 min-w-0">
          {/* Sort & Results Count */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <p className="text-sm text-muted-foreground">
              Showing {productsResult.items.length} of {productsResult.totalCount} product{productsResult.totalCount !== 1 ? "s" : ""}
            </p>
            <SortSelect value={filters.sort} />
          </div>

          {/* Product Grid */}
          {productsResult.items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {query ? `No products found matching "${query}".` : "No products found matching your criteria."}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {productsResult.items.map((product) => (
                <ProductCard key={product.id} product={product} display={display} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {productsResult.totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
              {page > 1 && (
                <Link
                  href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([k]) => k !== "page")), page: String(page - 1) }).toString()}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
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
                  className={buttonVariants({ variant: "outline", size: "sm" })}
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
  currentParams,
  counts,
}: {
  category: Awaited<ReturnType<typeof getCategoryTree>>[0];
  selected?: string;
  level: number;
  currentParams: Record<string, string | undefined>;
  counts?: Record<string, number>;
}) {
  const isSelected = selected === category.slug;
  const hasChildren = category.children.length > 0;
  const categoryCount = counts?.[category.id];

  return (
    <div className="pl-4" style={{ paddingLeft: `${level * 16 + 8}px` }}>
      <Link
        href={buildFilterHref("/search", { ...currentParams, q: currentParams.q?.trim() || undefined }, { category: category.slug })}
        className={`flex items-center justify-between gap-2 px-2 py-1 rounded text-sm ${isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-accent"}`}
      >
        <span>{category.name}</span>
        {categoryCount ? (
          <span className={`text-xs ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
            ({categoryCount})
          </span>
        ) : null}
      </Link>
      {hasChildren && (
        <nav className="space-y-1 mt-1">
          {category.children.map((child) => (
            <CategoryFilterLink
              key={child.id}
              category={child}
              selected={selected}
              level={level + 1}
              currentParams={currentParams}
              counts={counts}
            />
          ))}
        </nav>
      )}
    </div>
  );
}

function ProductCard({
  product,
  display,
}: {
  product: Awaited<ReturnType<typeof searchProducts>>["items"][0];
  display?: CardDisplayCurrency | null;
}) {
  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="aspect-square relative overflow-hidden rounded-lg bg-muted">
        {product.primaryImage ? (
          <Image
            src={product.primaryImage.url}
            alt={product.primaryImage.alt ?? product.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 33vw, 25vw"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">No Image</div>
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
          <span className="text-lg font-semibold">
            {formatUsdInDisplayCurrency(
              product.minVariantPrice ?? product.basePrice,
              display?.currency ?? "USD",
              display?.rates ?? {},
            )}
          </span>
          {product.comparePrice && Number(product.comparePrice) > Number(product.basePrice) && (
            <span className="text-sm line-through text-muted-foreground">
              {formatUsdInDisplayCurrency(product.comparePrice, display?.currency ?? "USD", display?.rates ?? {})}
            </span>
          )}
        </div>
        {product.brand && (
          <span className="text-xs text-muted-foreground">{product.brand.name}</span>
        )}
      </div>
    </Link>
  );
}

export default SearchContent;
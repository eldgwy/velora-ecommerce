import { Metadata } from "next";
import { searchProducts, getActiveBrands, getCategoryTree } from "@/services/catalog-public";
import { getProductPromotionSummaries } from "@/modules/promotions/application/queries/promotion-pricing";
import { ProductCard } from "@/shared/components/product/ProductCard";
import { buildDisplayCurrencyProps } from "@/shared/lib/currency-display-server";
import {
  InStockCheckbox,
  RatingFilter,
  SortSelect,
} from "@/shared/components/product/CatalogFilterControls";
import Link from "next/link";
import { Input } from "@/shared/components/ui/input";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { buildFilterHref } from "@/shared/lib/filter-links";
import { getCurrentSession } from "@/shared/lib/guards";
import { getSavedProductIds } from "@/modules/wishlist/application/queries/wishlist";

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
  const display = await buildDisplayCurrencyProps();
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

  // One batched promotion lookup for the whole grid (no per-card queries).
  // Display-only: checkout revalidates and charges from the same rules.
  const promoSummaries = await getProductPromotionSummaries(
    productsResult.items.map((p) => p.id),
  );

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
                href={buildFilterHref("/products", { ...params }, { category: undefined })}
                className={`block px-2 py-1 rounded text-sm ${!params.category ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                All Categories
              </Link>
              {categories.map((cat) => (
                <CategoryFilterLink key={cat.id} category={cat} selected={params.category} level={0} currentParams={{ ...params }} />
              ))}
            </nav>
          </section>

          {/* Brands */}
          <section>
            <h3 className="font-semibold mb-3">Brands</h3>
            <nav className="space-y-1 max-h-64 overflow-y-auto">
              <Link
                href={buildFilterHref("/products", { ...params }, { brand: undefined })}
                className={`block px-2 py-1 rounded text-sm ${!params.brand ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                All Brands
              </Link>
              {brands.map((brand) => (
                <Link
                  key={brand.id}
                  href={buildFilterHref("/products", { ...params }, { brand: brand.slug })}
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
              <Button type="submit" size="sm" className="w-full">Apply</Button>
            </form>
          </section>

          {/* In Stock */}
          <section>
            <InStockCheckbox checked={params.inStock === "true"} />
          </section>

          {/* Rating Filter */}
          <section>
            <h3 className="font-semibold mb-3">Rating</h3>
            <RatingFilter selected={params.rating} />
            <Link
              href="/products"
              className="block text-sm text-muted-foreground hover:text-foreground mt-1"
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
              Showing {productsResult.items.length} of {productsResult.totalCount} products
            </p>
            <SortSelect value={filters.sort} />
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
                  promotion={promoSummaries.get(product.id) ?? null}
                  display={display}
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
}: {
  category: Awaited<ReturnType<typeof getCategoryTree>>[0];
  selected?: string;
  level: number;
  currentParams: Record<string, string | undefined>;
}) {
  const isSelected = selected === category.slug;
  const hasChildren = category.children.length > 0;

  return (
    <div className="pl-4" style={{ paddingLeft: `${level * 16 + 8}px` }}>
      <Link
        href={buildFilterHref("/products", currentParams, { category: category.slug })}
        className={`block px-2 py-1 rounded text-sm ${isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-accent"}`}
      >
        {category.name}
      </Link>
      {hasChildren && (
        <nav className="space-y-1 mt-1">
          {category.children.map((child) => (
            <CategoryFilterLink key={child.id} category={child} selected={selected} level={level + 1} currentParams={currentParams} />
          ))}
        </nav>
      )}
    </div>
  );
}

export default ProductsContent;
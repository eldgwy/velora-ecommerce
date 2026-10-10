import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCategoryBySlug, listProducts, getCategoryTree } from "@/services/catalog-public";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Category Not Found" };
  return {
    title: category.name,
    description: category.description ?? undefined,
  };
}

async function CategoryContent({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  // Get subcategories
  const subcategories = category.children;

  // Get products in this category
  const { items: products } = await listProducts({ categorySlug: category.slug, pageSize: 24 });

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:underline">Home</Link>
          </li>
          <li aria-current="page">{category.name}</li>
        </ol>
      </nav>

      {/* Category Header */}
      <header className="mb-8">
        {category.logo && (
          <div className="mb-4">
            <img src={category.logo} alt="" className="h-24 w-auto" />
          </div>
        )}
        <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
        {category.description && (
          <p className="mt-2 text-muted-foreground">{category.description}</p>
        )}
      </header>

      {/* Subcategories */}
      {subcategories.length > 0 && (
        <section className="mb-12" aria-labelledby="subcategories-heading">
          <h2 id="subcategories-heading" className="text-2xl font-semibold mb-4">Subcategories</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {subcategories.map((sub) => (
              <Link
                key={sub.id}
                href={`/categories/${sub.slug}`}
                className="group p-4 border rounded-lg hover:border-primary/50 transition-colors"
              >
                {sub.logo && (
                  <div className="mb-2 aspect-square overflow-hidden rounded">
                    <img
                      src={sub.logo}
                      alt=""
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <h3 className="font-medium">{sub.name}</h3>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Products */}
      <section aria-labelledby="products-heading">
        <div className="flex items-center justify-between mb-4">
          <h2 id="products-heading" className="text-2xl font-semibold">Products</h2>
          <span className="text-sm text-muted-foreground">{products.length} products</span>
        </div>

        {products.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No products in this category yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProductCard({ product }: { product: Awaited<ReturnType<typeof listProducts>>["items"][0] }) {
  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="aspect-square relative overflow-hidden rounded-lg bg-muted">
        {product.primaryImage ? (
          <img
            src={product.primaryImage.url}
            alt={product.primaryImage.alt ?? product.name}
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">No Image</div>
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
  );
}

function formatPrice(price: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(price));
}

export default CategoryContent;
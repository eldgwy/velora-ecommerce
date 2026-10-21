import { listBrands } from "@/services/brand.service";
import { listCategories } from "@/services/catalog.service";
import { ProductForm } from "@/modules/catalog/presentation/components/product-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New product — VELORA Admin",
};

export default async function NewProductPage() {
  const [categories, brands] = await Promise.all([listCategories(), listBrands()]);
  categories.sort((a, b) => a.name.localeCompare(b.name));
  brands.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">New product</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Starts as a draft. Variants and images are managed on the product page after creation.
        </p>
      </div>
      <ProductForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
}

import { notFound } from "next/navigation";

import { getBrandById } from "@/services/brand.service";
import { listBrands } from "@/services/brand.service";
import { getCategoryById, listCategories } from "@/services/catalog.service";
import { getProductById } from "@/services/product.service";
import { listImagesByProduct } from "@/services/product-media.service";
import {
  listOptionsByProduct,
  listOptionValuesByOption,
} from "@/services/product-option.service";
import { listVariantsForAdmin } from "@/services/product-variant.service";
import { ProductForm } from "@/modules/catalog/presentation/components/product-form";
import { ProductImagesPanel } from "@/modules/catalog/presentation/components/product-images-panel";
import { VariantManagerPanel } from "@/modules/catalog/presentation/components/variant-manager-panel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit product — VELORA Admin",
};

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) notFound();

  const [images, variants, options, categories, brands] = await Promise.all([
    listImagesByProduct(id),
    listVariantsForAdmin(id),
    listOptionsByProduct(id),
    listCategories(),
    listBrands(),
  ]);
  // Small admin-surface N+1 (options per product are few); no batched helper
  // exists for option→values so the per-option read is explicit.
  const optionsWithValues = await Promise.all(
    options.map(async (o) => ({
      id: o.id,
      name: o.name,
      values: (await listOptionValuesByOption(o.id)).map((v) => ({ id: v.id, value: v.value })),
    })),
  );

  const [category, brand] = await Promise.all([
    getCategoryById(product.categoryId),
    getBrandById(product.brandId),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Edit product</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {product.name}
          {category ? ` · ${category.name}` : ""}
          {brand ? ` · ${brand.name}` : ""}
        </p>
      </div>

      <ProductForm
        initial={product}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      />

      <ProductImagesPanel
        productId={id}
        images={images.map((img) => ({
          id: img.id,
          url: img.url,
          publicId: img.publicId,
          alt: img.alt,
          isPrimary: img.isPrimary,
          sortOrder: img.sortOrder ?? 0,
        }))}
      />

      <VariantManagerPanel
        productId={id}
        basePrice={product.basePrice}
        options={optionsWithValues}
        variants={variants}
      />
    </div>
  );
}

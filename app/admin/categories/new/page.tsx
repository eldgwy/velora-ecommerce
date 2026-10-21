import { listCategories } from "@/services/catalog.service";
import { buildCategoryTree } from "@/modules/catalog/application/queries/category-tree";
import { CategoryForm } from "@/modules/catalog/presentation/components/category-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New category — VELORA Admin",
};

export default async function NewCategoryPage() {
  const categories = await listCategories();
  const tree = buildCategoryTree(categories);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">New category</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Parent nesting mirrors the storefront navigation; slugs are unique.
        </p>
      </div>
      <CategoryForm
        parentOptions={tree.map(({ row, depth }) => ({
          id: row.id,
          name: `${"—".repeat(Math.min(depth, 3))} ${row.name}`.trim(),
        }))}
      />
    </div>
  );
}

import { notFound } from "next/navigation";

import { getCategoryById, listCategories } from "@/services/catalog.service";
import { buildCategoryTree } from "@/modules/catalog/application/queries/category-tree";
import { CategoryForm } from "@/modules/catalog/presentation/components/category-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit category — VELORA Admin",
};

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [category, categories] = await Promise.all([getCategoryById(id), listCategories()]);
  if (!category) notFound();

  // The action's cycle guard is authoritative; this filter just prevents
  // obviously invalid choices (a category nesting under itself).
  const tree = buildCategoryTree(categories.filter((c) => c.id !== id));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Edit category</h1>
        <p className="mt-1 text-sm text-muted-foreground">{category.name}</p>
      </div>
      <CategoryForm
        initial={category}
        parentOptions={tree.map(({ row, depth }) => ({
          id: row.id,
          name: `${"—".repeat(Math.min(depth, 3))} ${row.name}`.trim(),
        }))}
      />
    </div>
  );
}

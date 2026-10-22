import { EmptyState } from "@/shared/components/ui/empty-state";
import { AdminPagination, parsePageParam } from "@/shared/components/ui/pagination";

import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { listCategories } from "@/services/catalog.service";
import { buildCategoryTree, pageCategoriesByRoot } from "@/modules/catalog/application/queries/category-tree";
import { CategoryActiveToggle } from "@/modules/catalog/presentation/components/category-active-toggle";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Categories — VELORA Admin",
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const categories = await listCategories();
  const tree = buildCategoryTree(categories);
  // Page by root so a category and its children are never separated.
  const page = pageCategoriesByRoot(tree, parsePageParam(pageParam));
  const pageHref = (p: number) => `/admin/categories?page=${p}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {page.totalRoots} root categor{page.totalRoots === 1 ? "y" : "ies"} (with
            children) · page {page.currentPage} of {page.totalPages}
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/categories/new">New category</Link>} />
      </div>

      {page.entries.length === 0 ? (
        <EmptyState title="No categories yet" description="Create one to begin." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Visible</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map(({ row, depth }) => (
                <tr key={row.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/categories/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                    >
                      {depth > 0 ? <span className="text-muted-foreground">↳ </span> : null}
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.slug}</td>
                  <td className="px-4 py-3 text-xs">
                    {"isActive" in row && row.isActive ? (
                      <span className="rounded-full bg-velora-emerald/10 px-2 py-0.5 font-semibold text-velora-emerald">
                        Visible
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
                        Hidden
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CategoryActiveToggle id={row.id} name={row.name} isActive={!!row.isActive} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination
        currentPage={page.currentPage}
        totalPages={page.totalPages}
        buildHref={pageHref}
        ariaLabel="Category pages"
      />
    </div>
  );
}

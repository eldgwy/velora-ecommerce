import { EmptyState } from "@/shared/components/ui/empty-state";
import { AdminPagination, parsePageParam } from "@/shared/components/ui/pagination";

import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { listAdminBrands } from "@/services/brand.service";
import { BrandDeleteButton } from "@/modules/catalog/presentation/components/brand-delete-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Brands — VELORA Admin",
};

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = parsePageParam(pageParam);
  const res = await listAdminBrands({ page });
  const pageHref = (p: number) => `/admin/brands?page=${p}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Brands</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {res.total} brand{res.total === 1 ? "" : "s"}
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/brands/new">New brand</Link>} />
      </div>

      {res.items.length === 0 ? (
        <EmptyState title="No brands yet" description="Create one to begin." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Website</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {res.items.map((brand) => (
                <tr key={brand.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/brands/${brand.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {brand.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{brand.slug}</td>
                  <td className="truncate px-4 py-3 text-xs text-muted-foreground">
                    {brand.website ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <BrandDeleteButton id={brand.id} name={brand.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination
        currentPage={res.currentPage}
        totalPages={res.totalPages}
        buildHref={pageHref}
        ariaLabel="Brand pages"
      />
    </div>
  );
}

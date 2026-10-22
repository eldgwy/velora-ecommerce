import { EmptyState } from "@/shared/components/ui/empty-state";
import { AdminPagination, parsePageParam } from "@/shared/components/ui/pagination";

import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatPrice } from "@/shared/lib/utils";
import { listAdminProducts } from "@/services/product.service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Products — VELORA Admin",
};

const STATUSES = ["all", "DRAFT", "ACTIVE", "ARCHIVE"] as const;

interface ProductsPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { status: statusParam, page: pageParam } = await searchParams;
  const status = STATUSES.includes(statusParam as (typeof STATUSES)[number])
    ? (statusParam as "DRAFT" | "ACTIVE" | "ARCHIVE" | "all")
    : undefined;
  const effectiveStatus =
    status && status !== "all" ? (status as "DRAFT" | "ACTIVE" | "ARCHIVE") : undefined;
  const page = parsePageParam(pageParam);
  const res = await listAdminProducts({ status: effectiveStatus, page });

  const statusHref = (s: string) => `/admin/products?status=${encodeURIComponent(s)}`;
  const pageHref = (p: number) =>
    `/admin/products?${new URLSearchParams({
      ...(status ? { status } : {}),
      page: String(p),
    }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {res.total} product{res.total === 1 ? "" : "s"}
            {status && status !== "all" ? ` · ${status}` : ""}
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/products/new">New product</Link>} />
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={statusHref(s)}
            className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
              (status ?? "all") === s
                ? "border-velora-emerald bg-velora-emerald/10 text-velora-emerald"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            {s === "all" ? "All" : s}
          </Link>
        ))}
      </div>

      {res.items.length === 0 ? (
        <EmptyState title="No products match" description="Create one to begin." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {res.items.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/products/${p.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{p.slug}</span>
                  </td>
                  <td className="px-4 py-3">
                    {formatPrice(p.basePrice)}
                    {p.comparePrice ? (
                      <span className="ml-2 text-xs text-muted-foreground line-through">
                        {formatPrice(p.comparePrice)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        p.status === "ACTIVE"
                          ? "bg-velora-emerald/10 text-velora-emerald"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.status}
                    </span>
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
        ariaLabel="Product pages"
      />

      <Separator />
      <p className="text-xs text-muted-foreground">
        Deleting is intentionally not offered here: historical orders reference products. Archive a
        product instead.
      </p>
    </div>
  );
}

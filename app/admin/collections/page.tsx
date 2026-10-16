import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { listCollectionsAction } from "@/modules/collections/presentation/actions/collection-admin.actions";
import { CollectionStatusBadge } from "@/modules/collections/presentation/components/collection-status-badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Collections — VELORA Admin",
};

interface CollectionsPageProps {
  searchParams: Promise<{ q?: string; active?: string; page?: string }>;
}

export default async function CollectionsPage({ searchParams }: CollectionsPageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const isActive =
    params.active === "true" ? true : params.active === "false" ? false : undefined;
  const res = await listCollectionsAction({ query: params.q, isActive, page, pageSize: 20 });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load collections</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
      </div>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const pageHref = (p: number) =>
    `/admin/collections?${new URLSearchParams({
      ...(params.q ? { q: params.q } : {}),
      ...(params.active ? { active: params.active } : {}),
      page: String(p),
    }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Collections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount} collection{totalCount === 1 ? "" : "s"} · unpublished collections stay hidden
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/collections/new">New collection</Link>} />
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/collections">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name…"
          aria-label="Search by name"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <select
          name="active"
          defaultValue={params.active ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Filter by publication"
        >
          <option value="">All</option>
          <option value="true">Published</option>
          <option value="false">Draft</option>
        </select>
        <Button size="sm" variant="outline" type="submit">
          Filter
        </Button>
      </form>

      {items.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">No collections match. Create one to begin.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-foreground/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Products</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/collections/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">/{c.slug}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.productCount}</td>
                  <td className="px-4 py-3">
                    <CollectionStatusBadge isActive={c.isActive} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <>
          <Separator />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage > 1 ? (
              <Button size="sm" variant="outline" render={<Link href={pageHref(currentPage - 1)}>← Prev</Link>} />
            ) : null}
            {currentPage < totalPages ? (
              <Button size="sm" variant="outline" render={<Link href={pageHref(currentPage + 1)}>Next →</Link>} />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

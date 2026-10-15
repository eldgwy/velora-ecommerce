import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { listPromotionsAction } from "@/modules/promotions/presentation/actions/promotion-admin.actions";
import { PromotionStatusBadge } from "@/modules/promotions/presentation/components/promotion-status-badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Promotions — VELORA Admin",
};

const STATUSES = ["all", "active", "inactive", "scheduled", "expired"] as const;

interface PromotionsPageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

export default async function PromotionsPage({ searchParams }: PromotionsPageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? params.status
    : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const res = await listPromotionsAction({ query: params.q, status, page, pageSize: 20 });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load promotions</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
      </div>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const pageHref = (p: number) =>
    `/admin/promotions?${new URLSearchParams({
      ...(params.q ? { q: params.q } : {}),
      ...(status ? { status } : {}),
      page: String(p),
    }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Promotions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount} promotion{totalCount === 1 ? "" : "s"} · edits never rewrite order history
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/promotions/new">New promotion</Link>} />
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/promotions">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name…"
          aria-label="Search by name"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status ?? "all"}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" type="submit">
          Filter
        </Button>
      </form>

      {items.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">No promotions match. Create one to begin.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-foreground/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Discount</th>
                <th className="px-4 py-3 font-medium">Products</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/promotions/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.type === "PERCENTAGE" ? `${p.value}%` : `$${p.value}`}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.productCount}</td>
                  <td className="px-4 py-3">
                    <PromotionStatusBadge status={p.status} />
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

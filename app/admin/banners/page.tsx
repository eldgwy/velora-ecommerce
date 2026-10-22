import { EmptyState } from "@/shared/components/ui/empty-state";
import { AdminPagination, parsePageParam } from "@/shared/components/ui/pagination";

import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { listBannersAction } from "@/modules/banners/presentation/actions/banner-admin.actions";
import { BannerStatusBadge } from "@/modules/banners/presentation/components/banner-status-badge";
import { BannerOrderManager } from "@/modules/banners/presentation/components/banner-order-manager";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Banners — VELORA Admin",
};

const STATUSES = ["all", "ACTIVE", "SCHEDULED", "EXPIRED", "DRAFT"] as const;

interface BannersPageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

export default async function BannersPage({ searchParams }: BannersPageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? params.status
    : undefined;
  const page = parsePageParam(params.page);
  const res = await listBannersAction({
    query: params.q,
    status: status === "all" ? undefined : (status as "ACTIVE" | "EXPIRED" | "SCHEDULED" | "DRAFT" | undefined),
    page,
    pageSize: 20,
  });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load banners</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
      </div>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const pageHref = (p: number) =>
    `/admin/banners?${new URLSearchParams({
      ...(params.q ? { q: params.q } : {}),
      ...(status ? { status } : {}),
      page: String(p),
    }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Hero banners</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount} banner{totalCount === 1 ? "" : "s"} · only ACTIVE banners in-window reach the storefront
          </p>
        </div>
        <Button size="sm" render={<Link href="/admin/banners/new">New banner</Link>} />
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/banners">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search title…"
          aria-label="Search by title"
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
        <EmptyState title="No banners match" description="Create one to begin." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Schedule</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/banners/${b.id}`} className="font-medium underline-offset-4 hover:underline">
                      {b.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {b.startsAt ? formatDate(new Date(b.startsAt)) : "—"}
                    {" → "}
                    {b.endsAt ? formatDate(new Date(b.endsAt)) : "open"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{b.sortOrder ?? "—"}</td>
                  <td className="px-4 py-3">
                    <BannerStatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages === 1 && items.length > 1 ? (
        <BannerOrderManager banners={items} />
      ) : totalPages > 1 ? (
        <p className="text-xs text-muted-foreground">
          Display order editing is available when all banners fit on one page — narrow the filters.
        </p>
      ) : null}

      {totalPages > 1 ? (
        <>
          <Separator />
          <AdminPagination currentPage={currentPage} totalPages={totalPages} buildHref={pageHref} ariaLabel="Banner pages" />
        </>
      ) : null}
    </div>
  );
}

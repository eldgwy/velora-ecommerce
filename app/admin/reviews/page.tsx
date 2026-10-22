import Link from "next/link";
import { AdminPagination, parsePageParam } from "@/shared/components/ui/pagination";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { getModerationQueueAction } from "@/modules/reviews/presentation/actions/review.actions";
import { ModerationRow } from "@/modules/reviews/presentation/components/moderation-queue";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reviews — VELORA Admin",
};

const STATUSES = ["pending", "approved", "rejected"] as const;

interface ReviewsPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? (params.status as (typeof STATUSES)[number])
    : "pending";
  const page = parsePageParam(params.page);
  const res = await getModerationQueueAction({ status, page, pageSize: 20 });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load reviews</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
      </div>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const pageHref = (p: number) =>
    `/admin/reviews?${new URLSearchParams({ status, page: String(p) }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Review moderation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} {status} review{totalCount === 1 ? "" : "s"} · pending reviews need a
          decision; moderated reviews can be re-moderated
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/reviews">
        <select
          name="status"
          defaultValue={status}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" type="submit">
          Filter
        </Button>
      </form>

      {items.length === 0 ? (
        <div className="rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">Nothing awaiting moderation.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <ModerationRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <>
          <Separator />
          <AdminPagination currentPage={currentPage} totalPages={totalPages} buildHref={pageHref} ariaLabel="Review pages" />
        </>
      ) : null}
    </div>
  );
}

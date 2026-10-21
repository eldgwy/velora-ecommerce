import { EmptyState } from "@/shared/components/ui/empty-state";

import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { getQuestionQueueAction } from "@/modules/product-questions/presentation/actions/question.actions";
import {
  AnswerForm,
  QuestionRowActions,
} from "@/modules/product-questions/presentation/components/question-moderation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Questions — VELORA Admin",
};

const STATUSES = ["PENDING", "ANSWERED", "REJECTED"] as const;

interface QuestionsPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

export default async function QuestionsPage({ searchParams }: QuestionsPageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? (params.status as (typeof STATUSES)[number])
    : "PENDING";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const res = await getQuestionQueueAction({ status, page, pageSize: 20 });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load questions</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
      </div>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const pageHref = (p: number) =>
    `/admin/questions?${new URLSearchParams({ status, page: String(p) }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Product questions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} {status.toLowerCase()} question{totalCount === 1 ? "" : "s"} · answers publish immediately
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/questions">
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
        <EmptyState title="Nothing here" description="Customer questions will appear here once submitted." />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{item.productName ?? "Removed product"}</span>
                <Link
                  href={`/products/${item.productId}`}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  View product
                </Link>
                <span className="ml-auto text-xs text-muted-foreground">
                  {item.userName ?? "Unknown customer"}
                </span>
              </div>
              <p className="text-sm font-medium">{item.question}</p>
              {item.answer ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{item.answer}</p>
              ) : null}
              {item.status === "PENDING" ? <AnswerForm questionId={item.id} /> : null}
              <div>
                <QuestionRowActions questionId={item.id} status={item.status} />
              </div>
            </li>
          ))}
        </ul>
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

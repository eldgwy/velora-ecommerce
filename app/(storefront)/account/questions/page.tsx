import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { requireSession } from "@/shared/lib/guards";
import { getMyQuestionsAction } from "@/modules/product-questions/presentation/actions/question.actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your questions — VELORA",
  description: "Questions you asked about our products.",
};

interface AccountQuestionsPageProps {
  searchParams: Promise<{ page?: string }>;
}

/**
 * Customer's own questions with per-row status. Strictly session-scoped;
 * answers show only where staff provided them.
 */
export default async function AccountQuestionsPage({ searchParams }: AccountQuestionsPageProps) {
  await requireSession("/account/questions");
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const res = await getMyQuestionsAction({ page, pageSize: 20 });

  if (!res.ok || !res.data) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold">Your questions</h1>
        <p className="mt-1 text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
      </main>
    );
  }

  const { items, totalCount, totalPages, currentPage } = res.data;
  const pageHref = (p: number) => `/account/questions?page=${p}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold">Your questions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {totalCount} question{totalCount === 1 ? "" : "s"} · answered questions appear on the product page
      </p>

      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <h2 className="text-xl font-semibold">No questions yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ask about sizing, materials, or care on any product page.
          </p>
          <Button size="lg" render={<Link href="/products">Browse products</Link>} />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  href={`/products/${item.productId}`}
                  className="font-semibold hover:underline"
                >
                  {item.productName ?? "Product"}
                </Link>
                <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium">
                  {item.status}
                </span>
              </div>
              <p className="text-sm font-medium">{item.question}</p>
              {item.answer ? (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Store answer
                  </p>
                  <p className="mt-1 text-sm">{item.answer}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Awaiting a staff answer · asked {formatDate(item.createdAt)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <>
          <Separator className="my-6" />
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
    </main>
  );
}

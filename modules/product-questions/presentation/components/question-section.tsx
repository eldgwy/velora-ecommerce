import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { listPublicQuestions } from "@/modules/product-questions/application/queries/questions";
import { QuestionForm } from "@/modules/product-questions/presentation/components/question-form";

const PAGE_SIZE = 5;

/**
 * Product Q&A section (server component): answered questions with staff
 * answers plus the submission form. Page comes from `?questionsPage=`.
 * Every row here is ANSWERED with an answer by construction of the query.
 */
export async function ProductQuestionSection({
  productId,
  signedIn,
  page,
}: {
  productId: string;
  signedIn: boolean;
  page: number;
}) {
  const list = await listPublicQuestions(productId, page, PAGE_SIZE);
  const pageHref = (p: number) => `?questionsPage=${p}#questions`;

  return (
    <section aria-label="Questions and answers" id="questions" className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold">Questions & answers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Answered by our store team — {list.totalCount} answered question
          {list.totalCount === 1 ? "" : "s"}.
        </p>
      </div>

      {list.totalCount === 0 ? (
        <div className="rounded-xl bg-white px-6 py-10 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">
            No answered questions yet. Ask below — answers from our team appear here.
          </p>
        </div>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {list.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-xl bg-white p-5 ring-1 ring-foreground/10"
              >
                <h3 className="font-semibold">{item.question}</h3>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Store answer
                  </p>
                  <p className="mt-1 text-sm">{item.answer}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Answered {item.answeredAt ? formatDate(item.answeredAt) : ""} · asked{" "}
                  {formatDate(item.createdAt)}
                </p>
              </li>
            ))}
          </ol>
          {list.totalPages > 1 ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {list.currentPage} of {list.totalPages}
              </span>
              {list.currentPage > 1 ? (
                <Button size="sm" variant="outline" render={<Link href={pageHref(list.currentPage - 1)}>← Prev</Link>} />
              ) : null}
              {list.currentPage < list.totalPages ? (
                <Button size="sm" variant="outline" render={<Link href={pageHref(list.currentPage + 1)}>Next →</Link>} />
              ) : null}
            </div>
          ) : null}
          <Separator />
        </>
      )}

      <QuestionForm productId={productId} signedIn={signedIn} />
    </section>
  );
}

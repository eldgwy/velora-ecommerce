import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import {
  listApprovedReviews,
  getRatingSummary,
} from "@/modules/reviews/application/queries/reviews";
import { RatingSummary } from "@/modules/reviews/presentation/components/rating-summary";
import { ReviewForm } from "@/modules/reviews/presentation/components/review-form";
import { ReviewItem } from "@/modules/reviews/presentation/components/review-item";

const PAGE_SIZE = 5;

/**
 * Product review section (server component): summary, submission form, and
 * paginated approved-only list. Page comes from `?reviewsPage=`; every row
 * here is APPROVED by construction of the queries below.
 */
export async function ProductReviewSection({
  productId,
  signedIn,
  page,
}: {
  productId: string;
  signedIn: boolean;
  page: number;
}) {
  const [summary, list] = await Promise.all([
    getRatingSummary(productId),
    listApprovedReviews(productId, page, PAGE_SIZE),
  ]);
  const pageHref = (p: number) => `?reviewsPage=${p}#reviews`;

  return (
    <section aria-label="Customer reviews" id="reviews" className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">Customer reviews</h2>

      {summary.reviewCount === 0 ? (
        <div className="rounded-xl bg-card px-6 py-10 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">
            No reviews yet. Be the first to share your experience.
          </p>
        </div>
      ) : (
        <>
          <RatingSummary summary={summary} />
          <Separator />
          <ol className="flex flex-col gap-3">
            {list.items.map((review) => (
              <li key={review.id}>
                <ReviewItem review={review} />
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

      <ReviewForm productId={productId} signedIn={signedIn} />
    </section>
  );
}

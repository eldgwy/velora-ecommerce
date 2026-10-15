import { formatDate } from "@/shared/lib/format";
import { StarRatingDisplay } from "@/modules/reviews/presentation/components/star-rating";
import { VerifiedBuyerBadge } from "@/modules/reviews/presentation/components/verified-badge";
import type { PublicReviewView } from "@/modules/reviews/application/queries/reviews";

/** One approved review: author, rating, text, images, verified badge. */
export function ReviewItem({ review }: { review: PublicReviewView }) {
  return (
    <article className="flex flex-col gap-2 rounded-xl bg-white p-5 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2">
        <StarRatingDisplay rating={review.rating} />
        {review.isVerifiedBuyer ? <VerifiedBuyerBadge /> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDate(review.createdAt)}
        </span>
      </div>
      {review.title ? <h3 className="font-semibold">{review.title}</h3> : null}
      {review.content ? <p className="text-sm text-muted-foreground">{review.content}</p> : null}
      {review.images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {review.images.map((img) =>
            img.url ? (
              <img
                key={img.id}
                src={img.url}
                alt={review.title ?? "Review photo"}
                className="size-20 rounded-lg object-cover"
                loading="lazy"
              />
            ) : null,
          )}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        — {review.userName ?? "Verified customer"}
      </p>
    </article>
  );
}

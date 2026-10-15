import { StarRatingDisplay } from "@/modules/reviews/presentation/components/star-rating";
import type { RatingSummary } from "@/modules/reviews/application/queries/reviews";

/**
 * Rating summary: average, total count, and per-star distribution bars.
 * Text accompanies every visual (never color- or width-alone).
 */
export function RatingSummary({ summary }: { summary: RatingSummary }) {
  const { averageRating, reviewCount, distribution } = summary;
  if (reviewCount === 0) return null;
  const max = Math.max(1, ...Object.values(distribution));
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
      <div className="flex flex-col items-center gap-1">
        <span className="text-4xl font-bold" aria-label={`Average rating ${averageRating?.toFixed(1) ?? "—"} out of 5`}>
          {averageRating?.toFixed(1) ?? "—"}
        </span>
        <StarRatingDisplay rating={averageRating} />
        <span className="text-sm text-muted-foreground">
          Based on {reviewCount} review{reviewCount === 1 ? "" : "s"}
        </span>
      </div>
      <dl className="flex w-full max-w-xs flex-col gap-1">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = distribution[star] ?? 0;
          return (
            <div key={star} className="flex items-center gap-2 text-sm">
              <dt className="w-10 shrink-0 text-muted-foreground">{star} ★</dt>
              <dd className="flex flex-1 items-center gap-2">
                <span
                  className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${count} ${star}-star reviews`}
                >
                  <span
                    className="block h-full rounded-full bg-amber-500"
                    style={{ width: `${Math.round((count / max) * 100)}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-muted-foreground">{count}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

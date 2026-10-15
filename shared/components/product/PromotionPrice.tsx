import { Badge } from "@/shared/components/ui/badge";
import { formatPrice } from "@/shared/lib/utils";

/**
 * Promotional price display (presentational only — all figures arrive
 * precomputed from the centralized promotion selection, never calculated
 * here). Renders the effective price, the struck-through list price, and a
 * sale badge only when the price is actually lower.
 */
export function PromotionPrice({
  listPrice,
  effectivePrice,
  promotionName,
  endsAt,
  size = "md",
  badgeLabel,
}: {
  listPrice: string;
  effectivePrice: string;
  promotionName?: string | null;
  endsAt?: string | Date | null;
  size?: "sm" | "md" | "lg";
  badgeLabel?: string;
}) {
  const discounted =
    Number(effectivePrice) < Number(listPrice) && Number(effectivePrice) >= 0;
  const priceClass =
    size === "lg" ? "text-3xl font-bold" : size === "sm" ? "text-lg font-semibold" : "text-2xl font-bold";
  const wasClass =
    size === "lg" ? "text-xl line-through text-muted-foreground" : "text-sm line-through text-muted-foreground";

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={priceClass}>{formatPrice(discounted ? effectivePrice : listPrice)}</span>
      {discounted ? (
        <>
          <span className={wasClass}>{formatPrice(listPrice)}</span>
          <Badge variant="secondary" title={promotionName ?? undefined}>
            {badgeLabel ?? "Sale"}
          </Badge>
          {endsAt ? (
            <span className="text-xs text-muted-foreground">
              Ends{" "}
              {new Date(endsAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

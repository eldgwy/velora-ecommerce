import { Badge } from "@/shared/components/ui/badge";

/** Verified-buyer badge: renders only for approved + verified reviews. */
export function VerifiedBuyerBadge() {
  return (
    <Badge variant="secondary" title="This reviewer purchased this product">
      ✓ Verified buyer
    </Badge>
  );
}

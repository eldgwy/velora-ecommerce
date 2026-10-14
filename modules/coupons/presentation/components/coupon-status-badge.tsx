import { Badge } from "@/shared/components/ui/badge";
import type { CouponDisplayStatus } from "@/modules/coupons/domain/coupon-rules";

const VARIANTS: Record<CouponDisplayStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  SCHEDULED: "secondary",
  EXPIRED: "destructive",
  EXHAUSTED: "destructive",
  INACTIVE: "outline",
};

/** Status pill for coupon states (read-only display). */
export function CouponStatusBadge({ status }: { status: CouponDisplayStatus }) {
  return <Badge variant={VARIANTS[status]}>{status}</Badge>;
}

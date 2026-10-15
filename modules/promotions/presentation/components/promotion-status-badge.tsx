import { Badge } from "@/shared/components/ui/badge";
import type { PromotionDisplayStatus } from "@/modules/promotions/application/queries/promotions";

const VARIANTS: Record<PromotionDisplayStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  SCHEDULED: "secondary",
  EXPIRED: "destructive",
  INACTIVE: "outline",
};

/** Status pill for promotion states (read-only display). */
export function PromotionStatusBadge({ status }: { status: PromotionDisplayStatus }) {
  return <Badge variant={VARIANTS[status]}>{status}</Badge>;
}

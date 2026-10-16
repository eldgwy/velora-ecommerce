import { Badge } from "@/shared/components/ui/badge";
import type { BannerStatus } from "@/modules/banners/domain/banner-rules";

const VARIANTS: Record<BannerStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  SCHEDULED: "secondary",
  EXPIRED: "destructive",
  DRAFT: "outline",
};

/** Status pill for banner lifecycle states (read-only display). */
export function BannerStatusBadge({ status }: { status: BannerStatus }) {
  return <Badge variant={VARIANTS[status]}>{status}</Badge>;
}

import { Badge } from "@/shared/components/ui/badge";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary",
  PROCESSING: "default",
  SHIPPED: "outline",
  DELIVERED: "default",
  CANCELLED: "destructive",
};

const PAYMENT_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PAID: "default",
  PENDING: "secondary",
  FAILED: "destructive",
  CANCELLED: "destructive",
  EXPIRED: "destructive",
  REFUNDED: "outline",
  PARTIALLY_REFUNDED: "outline",
  AUTHORIZED: "secondary",
  REQUIRES_ACTION: "secondary",
};

/** Status pill for order and payment states (read-only display). */
export function OrderStatusBadge({ status, kind = "order" }: { status: string | null; kind?: "order" | "payment" }) {
  if (!status) return null;
  const variants = kind === "order" ? STATUS_VARIANTS : PAYMENT_VARIANTS;
  return <Badge variant={variants[status] ?? "outline"}>{status}</Badge>;
}

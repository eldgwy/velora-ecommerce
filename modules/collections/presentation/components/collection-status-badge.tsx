import { Badge } from "@/shared/components/ui/badge";

type CollectionStatus = "active" | "inactive";

/** Status pill for collection publication state (read-only display). */
export function CollectionStatusBadge({ isActive }: { isActive: boolean }) {
  const status: CollectionStatus = isActive ? "active" : "inactive";
  return (
    <Badge variant={status === "active" ? "default" : "outline"}>
      {status === "active" ? "Published" : "Draft"}
    </Badge>
  );
}

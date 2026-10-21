import { AdminTableSkeleton } from "@/shared/components/loading/skeletons";

/** Admin segment loading boundary (GP-23 / T-3.1) — mirrors the console's
 * header/toolbar/table rhythm while segment data loads. */
export default function AdminLoading() {
  return <AdminTableSkeleton />;
}

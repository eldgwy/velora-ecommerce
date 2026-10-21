import { AuthCardSkeleton } from "@/shared/components/loading/skeletons";

/** (auth) segment loading boundary (GP-23 / T-3.1). */
export default function AuthLoading() {
  return <AuthCardSkeleton />;
}

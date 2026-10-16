import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

import { getEligibleBanners } from "@/modules/banners/application/queries/banners";
import { cacheTags } from "@/shared/lib/cache/tag-names";

/**
 * Public hero banners. Eligibility (ACTIVE + live window + sortOrder ASC)
 * is enforced in the query on every computation; results cache briefly so
 * schedule boundaries take effect within the freshness window even if the
 * sync job has not run. Mutations invalidate the tags below.
 */
const getCachedBanners = unstable_cache(
  async () => getEligibleBanners(new Date()),
  ["hero-banners"],
  { tags: [cacheTags.bannersList], revalidate: 60 },
);

export async function GET(): Promise<NextResponse> {
  try {
    const items = await getCachedBanners();
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } },
    );
  } catch (error) {
    console.error("[banners] eligible error:", error);
    // A failed banner fetch must never break the homepage: callers fall
    // back to the static hero when this errors or returns empty.
    return NextResponse.json({ items: [] });
  }
}

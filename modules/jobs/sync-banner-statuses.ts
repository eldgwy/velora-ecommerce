import { and, eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { banners } from "@/infrastructure/database/schema/marketing";
import { deriveBannerStatus, type BannerStatus } from "@/modules/banners/domain/banner-rules";
import { logger } from "@/shared/lib/logging/logger";

export interface BannerSyncResult {
  id: string;
  from: BannerStatus;
  to: BannerStatus;
}

export interface BannerSyncSummary {
  processed: number;
  transitioned: number;
  results: BannerSyncResult[];
  durationMs: number;
}

/**
 * Status synchronization for scheduled banners. Moves SCHEDULED rows whose
 * window opened to ACTIVE, SCHEDULED rows whose window already closed to
 * EXPIRED, and ACTIVE rows past their end to EXPIRED — one clock value for
 * the whole run. Never touches DRAFT (not scheduled) and never publishes
 * from EXPIRED (re-publication is an explicit admin choice).
 *
 * This job is a convenience for stored-status hygiene only: the public
 * eligibility query re-checks the window live, so correctness never
 * depends on this job having run.
 */
export async function syncBannerStatuses(now: Date = new Date()): Promise<BannerSyncSummary> {
  const started = Date.now();
  const candidates = await db
    .select({
      id: banners.id,
      status: banners.status,
      startsAt: banners.startsAt,
      endsAt: banners.endsAt,
    })
    .from(banners)
    .where(
      and(
        sql`${banners.status} IN ('SCHEDULED', 'ACTIVE')`,
        sql`(${banners.startsAt} IS NULL OR ${banners.startsAt} <= ${now.toISOString()})`,
      ),
    );

  const results: BannerSyncResult[] = [];
  for (const row of candidates) {
    const from = row.status as BannerStatus;
    const derived = deriveBannerStatus(
      { status: from, startsAt: row.startsAt, endsAt: row.endsAt },
      now,
    );
    // Auto-transitions only: scheduled openings and expirations. DRAFT and
    // EXPIRED rows are never moved by the sync.
    const auto =
      (from === "SCHEDULED" && (derived === "ACTIVE" || derived === "EXPIRED")) ||
      (from === "ACTIVE" && derived === "EXPIRED");
    if (!auto || derived === from) continue;

    const updated = await db
      .update(banners)
      .set({ status: derived, updatedAt: new Date() })
      .where(and(eq(banners.id, row.id), eq(banners.status, from)))
      .returning({ id: banners.id });
    if (updated.length === 0) continue;

    logger.info("Banner status synchronized", {
      module: "banners",
      action: "bannerStatusSynced",
      bannerId: row.id,
      fromStatus: from,
      toStatus: derived,
    });
    results.push({ id: row.id, from, to: derived });
  }

  const { invalidateBannerCache } = await import("@/shared/lib/cache/tags");
  if (results.length > 0) {
    try {
      for (const r of results) {
        await invalidateBannerCache(r.id);
      }
    } catch (error) {
      if (!(error instanceof Error && /Server Action/.test(error.message))) throw error;
    }
  }

  return {
    processed: candidates.length,
    transitioned: results.length,
    results,
    durationMs: Date.now() - started,
  };
}

/**
 * Internal API handler, protected by the same CRON_SECRET bearer pattern
 * as the other job endpoints.
 */
export async function handleBannerSyncRequest(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized attempt to access banner sync endpoint", {
      module: "banners",
      action: "handleBannerSyncRequest",
    });

    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await syncBannerStatuses();

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    logger.error("Banner sync job failed", {
      module: "banners",
      action: "handleBannerSyncRequest",
      error: errorMessage,
    });

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

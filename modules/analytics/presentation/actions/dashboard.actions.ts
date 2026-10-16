"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  getInventoryAlertSummary,
  getSalesSummary,
  getSalesVelocity,
  normalizeReportRange,
  type InventoryAlertSummary,
  type SalesSummary,
  type VelocityBucket,
} from "@/modules/analytics/application/queries/dashboard";

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD."),
});

export interface DashboardData {
  summary: SalesSummary;
  velocity: VelocityBucket[];
  alerts: InventoryAlertSummary;
}

/**
 * Executive dashboard dataset (admin-gated). Computed live per request —
 * reported as refreshed-on-load, never cached as real-time. Failures
 * surface as errors, never as zero-valued metrics.
 */
export async function getDashboardDataAction(
  input: unknown,
): Promise<ActionResult<DashboardData>> {
  await requireAdmin();
  const now = new Date();
  const fallback = {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
  };
  const parsed = rangeSchema.safeParse(input ?? {});
  let from = fallback.from;
  let to = fallback.to;
  if (parsed.success) {
    from = new Date(`${parsed.data.from}T00:00:00Z`);
    to = new Date(`${parsed.data.to}T00:00:00Z`);
  }
  try {
    const range = normalizeReportRange(from, to);
    const [summary, velocity, alerts] = await Promise.all([
      getSalesSummary(range.from, range.to),
      getSalesVelocity(range.from, range.to),
      getInventoryAlertSummary(),
    ]);
    return { ok: true, data: { summary, velocity, alerts } };
  } catch (error) {
    logger.error("Dashboard dataset failed", {
      module: "analytics",
      action: "getDashboardData",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "The dashboard could not be loaded. Please try again." };
  }
}

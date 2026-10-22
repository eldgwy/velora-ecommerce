"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  getInventoryAlertSummary,
  getOrderStatusBreakdown,
  getPaymentStatusBreakdown,
  getSalesSummary,
  getSalesVelocity,
  getTopSellingProducts,
  isDashboardRangePreset,
  normalizeReportRange,
  resolveDashboardRange,
  type InventoryAlertSummary,
  type SalesSummary,
  type StatusCountBucket,
  type TopSellingProduct,
  type VelocityBucket,
} from "@/modules/analytics/application/queries/dashboard";

const customRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD."),
});

const dashboardRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  range: z.string().refine(isDashboardRangePreset, "Unknown reporting period.").optional(),
});

export interface DashboardData {
  summary: SalesSummary;
  velocity: VelocityBucket[];
  alerts: InventoryAlertSummary;
  orderStatus: StatusCountBucket[];
  paymentStatus: StatusCountBucket[];
  topProducts: TopSellingProduct[];
  rangeKind: string;
}

/**
 * Executive dashboard dataset (admin-gated). Computed live per request —
 * reported as refreshed-on-load, never cached as real-time. Failures
 * surface as errors, never as zero-valued metrics. Periods: a `range`
 * preset (today | 7d | 30d | 90d) or the existing custom from/to window
 * (custom takes precedence). Both are validated against the business
 * rules (half-open UTC days, max 90 days) with precise failure messages.
 */
export async function getDashboardDataAction(
  input: unknown,
): Promise<ActionResult<DashboardData>> {
  await requireAdmin();

  const now = new Date();
  const parsed = dashboardRangeSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: "The reporting period is not valid." };
  }
  const resolved = resolveDashboardRange(parsed.data, now);
  if (resolved.kind === "custom") {
    const custom = customRangeSchema.safeParse({ from: parsed.data.from, to: parsed.data.to });
    if (!custom.success) {
      return { ok: false, error: "Custom reporting dates are not valid." };
    }
  }

  // Business-rule validation (order, span) is reported precisely instead
  // of surfacing as a generic load failure.
  try {
    normalizeReportRange(resolved.from, resolved.to);
  } catch {
    return {
      ok: false,
      error:
        resolved.kind === "custom"
          ? "Custom reporting dates are not valid. Use a range of up to 90 days."
          : "The reporting period is not valid.",
    };
  }

  try {
    const range = normalizeReportRange(resolved.from, resolved.to);
    const [summary, velocity, alerts, orderStatus, paymentStatus, topProducts] = await Promise.all([
      getSalesSummary(range.from, range.to),
      getSalesVelocity(range.from, range.to),
      getInventoryAlertSummary(),
      getOrderStatusBreakdown(range.from, range.to),
      getPaymentStatusBreakdown(range.from, range.to),
      getTopSellingProducts(range.from, range.to),
    ]);
    return {
      ok: true,
      data: { summary, velocity, alerts, orderStatus, paymentStatus, topProducts, rangeKind: resolved.kind },
    };
  } catch (error) {
    logger.error("Dashboard dataset failed", {
      module: "analytics",
      action: "getDashboardData",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "The dashboard could not be loaded. Please try again." };
  }
}

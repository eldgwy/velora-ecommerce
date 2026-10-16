import { sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/infrastructure/database";
import { getLowStockAlertStats } from "@/modules/inventory/application/low-stock-alerts";

/**
 * Executive sales analytics (server-side SQL aggregation — order rows are
 * never loaded into application memory).
 *
 * Metric definitions (see docs/analytics.md):
 * - Qualifying orders: status PROCESSING | SHIPPED | DELIVERED (paid or
 *   COD-fulfilled flow). PENDING, CANCELLED, failed, and unpaid orders are
 *   excluded from every revenue metric.
 * - GMV: SUM(persisted total_amount) over qualifying orders in the period
 *   (post-discount snapshots, never repriced).
 * - Net revenue: GMV minus COMPLETED refunds recorded in the period
 *   against qualifying orders.
 * - AOV: GMV / qualifying order count (null when empty — never a fake 0).
 * - Currency: USD-only system. Totals aggregate USD rows; non-USD rows in
 *   range are counted separately and excluded, never silently converted.
 * - Periods are half-open UTC day boundaries [from, to), max 90 days.
 */

export const REPORTING_CURRENCY = "USD";
export const MAX_REPORT_DAYS = 90;

export interface SalesSummary {
  currency: string;
  orderCount: number;
  gmv: string;
  refunded: string;
  netRevenue: string;
  averageOrderValue: string | null;
  excludedNonUsdOrders: number;
  from: string;
  to: string;
}

export interface VelocityBucket {
  date: string;
  gmv: string;
  orderCount: number;
}

export function validateReportRange(from: Date, to: Date): void {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Reporting dates are invalid.");
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error("Reporting start must precede reporting end.");
  }
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > MAX_REPORT_DAYS) {
    throw new Error(`Reporting range is limited to ${MAX_REPORT_DAYS} days.`);
  }
}

function toDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Normalize arbitrary bounds to UTC day walls [from, to). */
export function normalizeReportRange(from: Date, to: Date): { from: Date; to: Date } {
  validateReportRange(from, to);
  const start = toDayStart(from);
  let end = toDayStart(to);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 86_400_000);
  }
  return { from: start, to: end };
}

interface OrderAggregateRow {
  count: number;
  total: string | null;
  nonUsd: number;
}

/** GMV + count over qualifying USD orders; non-USD rows counted, excluded. */
export async function getSalesSummary(from: Date, to: Date): Promise<SalesSummary> {
  const range = normalizeReportRange(from, to);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [row] = (await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE currency = 'USD')::int AS "count",
           SUM(total_amount) FILTER (WHERE currency = 'USD') AS "total",
           COUNT(*) FILTER (WHERE currency <> 'USD')::int AS "nonUsd"
    FROM orders
    WHERE status IN ('PROCESSING', 'SHIPPED', 'DELIVERED')
      AND created_at >= ${fromIso}
      AND created_at < ${toIso}
  `)) as unknown as Array<OrderAggregateRow>;

  const count = row?.count ?? 0;
  const gmv = new Decimal(row?.total ?? 0);
  const refunded = await getPeriodRefunds(fromIso, toIso);
  const net = gmv.minus(refunded);

  return {
    currency: REPORTING_CURRENCY,
    orderCount: count,
    gmv: gmv.toFixed(2),
    refunded: refunded.toFixed(2),
    netRevenue: net.toFixed(2),
    averageOrderValue: count > 0 ? gmv.div(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) : null,
    excludedNonUsdOrders: row?.nonUsd ?? 0,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  };
}

async function getPeriodRefunds(fromIso: string, toIso: string): Promise<Decimal> {
  const [row] = (await db.execute(sql`
    SELECT COALESCE(SUM(r.amount), 0) AS "total"
    FROM refunds AS r
    INNER JOIN payments AS p ON p.id = r.payment_id
    INNER JOIN orders AS o ON o.id = p.order_id
    WHERE r.status = 'COMPLETED'
      AND r.created_at >= ${fromIso}
      AND r.created_at < ${toIso}
      AND o.status IN ('PROCESSING', 'SHIPPED', 'DELIVERED')
  `)) as unknown as Array<{ total: string | number }>;
  return new Decimal(row?.total ?? 0);
}

/**
 * Daily GMV buckets (UTC walls — the stored convention, so session
 * timezone cannot shift boundaries). Ordered ascending, no gaps filled:
 * days without qualifying orders simply have no bucket.
 */
export async function getSalesVelocity(from: Date, to: Date): Promise<VelocityBucket[]> {
  const range = normalizeReportRange(from, to);
  const rows = (await db.execute(sql`
    SELECT date_trunc('day', created_at)::date AS "day",
           SUM(total_amount) AS "total",
           COUNT(*)::int AS "count"
    FROM orders
    WHERE status IN ('PROCESSING', 'SHIPPED', 'DELIVERED')
      AND currency = 'USD'
      AND created_at >= ${range.from.toISOString()}
      AND created_at < ${range.to.toISOString()}
    GROUP BY 1
    ORDER BY 1 ASC
  `)) as unknown as Array<{ day: string; total: string; count: number }>;
  return rows.map((r) => ({
    date: typeof r.day === "string" ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10),
    gmv: new Decimal(r.total ?? 0).toFixed(2),
    orderCount: r.count,
  }));
}

export interface InventoryAlertSummary {
  open: number;
  pending: number;
  processing: number;
}

/** Open alerts (PENDING + PROCESSING) via the established alert rules. */
export async function getInventoryAlertSummary(): Promise<InventoryAlertSummary> {
  const stats = await getLowStockAlertStats();
  // COUNT aggregates arrive as strings from the driver; coerce for math.
  const pending = Number(stats.pending) || 0;
  const processing = Number(stats.processing) || 0;
  return { open: pending + processing, pending, processing };
}

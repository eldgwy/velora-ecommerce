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

/**
 * Dashboard range presets. The `from`/`to` custom window (the existing
 * convention) always takes precedence; presets exist so the dashboard can
 * be navigated without hand-typing dates. All windows are half-open UTC
 * days `[from, to)` ending at tomorrow's wall so "today" is complete.
 */
export const DASHBOARD_RANGE_PRESETS = ["today", "7d", "30d", "90d"] as const;
export type DashboardRangePreset = (typeof DASHBOARD_RANGE_PRESETS)[number];
export type DashboardRangeKind = DashboardRangePreset | "custom";

const PRESET_SPAN_DAYS: Record<DashboardRangePreset, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function isDashboardRangePreset(value: string): value is DashboardRangePreset {
  return (DASHBOARD_RANGE_PRESETS as readonly string[]).includes(value);
}

/**
 * Pure range resolution (no DB): custom `from`/`to` win; otherwise a valid
 * preset maps to its trailing-day window; anything invalid falls back to
 * the 30-day window. Returns the raw bounds — business validation
 * (normalizeReportRange) still runs on the result.
 */
export function resolveDashboardRange(
  input: { range?: string | null; from?: string | null; to?: string | null },
  now: Date,
): { from: Date; to: Date; kind: DashboardRangeKind } {
  const dayStart = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const tomorrow = new Date(dayStart(now).getTime() + 86_400_000);

  if (input.from && input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.from) && /^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
    return { from: new Date(`${input.from}T00:00:00Z`), to: new Date(`${input.to}T00:00:00Z`), kind: "custom" };
  }

  const preset = input.range && isDashboardRangePreset(input.range) ? input.range : "30d";
  const span = PRESET_SPAN_DAYS[preset];
  return {
    from: new Date(tomorrow.getTime() - span * 86_400_000),
    to: tomorrow,
    kind: preset,
  };
}

export interface StatusCountBucket {
  status: string;
  count: number;
}

/**
 * Order lifecycle distribution: counts EVERY order status including
 * PENDING and CANCELLED — this is an operational volume view, not a
 * revenue population (revenue metrics stay in getSalesSummary).
 */
export async function getOrderStatusBreakdown(from: Date, to: Date): Promise<StatusCountBucket[]> {
  const range = normalizeReportRange(from, to);
  const rows = (await db.execute(sql`
    SELECT status::text AS status, COUNT(*)::int AS count
    FROM orders
    WHERE created_at >= ${range.from.toISOString()}
      AND created_at < ${range.to.toISOString()}
    GROUP BY status
    ORDER BY count DESC, status ASC
  `)) as unknown as Array<{ status: string; count: number }>;
  return rows.map((r) => ({ status: r.status, count: Number(r.count) || 0 }));
}

/**
 * Payment state distribution over the same period-wide order population
 * (persisted payment_status snapshot on orders — no payment secrets).
 */
export async function getPaymentStatusBreakdown(from: Date, to: Date): Promise<StatusCountBucket[]> {
  const range = normalizeReportRange(from, to);
  const rows = (await db.execute(sql`
    SELECT payment_status::text AS status, COUNT(*)::int AS count
    FROM orders
    WHERE created_at >= ${range.from.toISOString()}
      AND created_at < ${range.to.toISOString()}
      AND payment_status IS NOT NULL
    GROUP BY payment_status
    ORDER BY count DESC, status ASC
  `)) as unknown as Array<{ status: string; count: number }>;
  return rows.map((r) => ({ status: r.status, count: Number(r.count) || 0 }));
}

export interface TopSellingProduct {
  sku: string;
  productName: string | null;
  unitsSold: number;
  /** SUM of persisted order_items total_amount for qualifying orders. */
  netSales: string;
}

/**
 * Top-selling products ranked by UNITS SOLD (gross units on the persisted
 * line snapshot) over qualifying USD orders in the period. Refunds do not
 * retro-adjust units; their revenue impact is already in net revenue.
 * Deterministic tie-break by sku so equal sellers rank stably. Only
 * persisted snapshots are read — repriced rows can never appear.
 */
export async function getTopSellingProducts(
  from: Date,
  to: Date,
  limit = 5,
): Promise<TopSellingProduct[]> {
  const range = normalizeReportRange(from, to);
  const rows = (await db.execute(sql`
    SELECT oi.sku AS sku,
           MAX(oi.product_name) AS "productName",
           SUM(oi.quantity)::int AS "unitsSold",
           SUM(oi.total_amount) AS "netSales"
    FROM order_items AS oi
    INNER JOIN orders AS o ON o.id = oi.order_id
    WHERE o.status IN ('PROCESSING', 'SHIPPED', 'DELIVERED')
      AND o.currency = 'USD'
      AND o.created_at >= ${range.from.toISOString()}
      AND o.created_at < ${range.to.toISOString()}
    GROUP BY oi.sku
    ORDER BY "unitsSold" DESC, oi.sku ASC
    LIMIT ${limit}
  `)) as unknown as Array<{
    sku: string;
    productName: string | null;
    unitsSold: number;
    netSales: string | null;
  }>;
  return rows.map((r) => ({
    sku: r.sku,
    productName: r.productName,
    unitsSold: Number(r.unitsSold) || 0,
    netSales: new Decimal(r.netSales ?? 0).toFixed(2),
  }));
}

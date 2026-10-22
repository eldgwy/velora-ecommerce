import Link from "next/link";

import { formatPrice } from "@/shared/lib/utils";
import { getDashboardDataAction } from "@/modules/analytics/presentation/actions/dashboard.actions";
import {
  DistributionChart,
  OrderVolumeChart,
  RevenueTrendChart,
  TopProductsChart,
} from "@/modules/analytics/presentation/components/dashboard-charts";
import type { DashboardRangeKind } from "@/modules/analytics/application/queries/dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — VELORA Admin",
};

const RANGE_PRESETS: Array<{ value: Exclude<DashboardRangeKind, "custom">; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const RANGE_LABELS: Record<DashboardRangeKind, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom range",
};

function KpiCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-velora-emerald"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">{body}</div>;
}

interface DashboardPageProps {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>;
}

export default async function AdminDashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const res = await getDashboardDataAction({ from: params.from, to: params.to, range: params.range });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
          <Link
            href="/admin"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Back to 30-day view
          </Link>
        </div>
      </div>
    );
  }

  const { summary, velocity, alerts, orderStatus, paymentStatus, topProducts, rangeKind } = res.data;
  const range = rangeKind as DashboardRangeKind;
  const fromLabel = summary.from.slice(0, 10);
  const toLabel = summary.to.slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {RANGE_LABELS[range]} · {fromLabel} → {toLabel} (UTC) · refreshed on load ·{" "}
            {summary.currency}
          </p>
        </div>
      </div>

      {/* Reporting period: presets the administrative conventions resolve
          server-side; custom dates stay the explicit source of truth. */}
      <div className="flex flex-col gap-3">
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Reporting period">
          {RANGE_PRESETS.map((preset) => {
            const active = range === preset.value;
            return (
              <Link
                key={preset.value}
                href={`/admin?range=${preset.value}`}
                aria-current={active ? "true" : undefined}
                className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
                  active
                    ? "border-velora-emerald bg-velora-emerald/10 text-velora-emerald"
                    : "border-border bg-card hover:bg-muted"
                }`}
              >
                {preset.label}
              </Link>
            );
          })}
          {range === "custom" ? (
            <span
              aria-current="true"
              className="rounded-lg border border-velora-emerald bg-velora-emerald/10 px-3 py-1.5 font-medium text-velora-emerald"
            >
              Custom range
            </span>
          ) : null}
        </nav>
        <form method="get" className="flex flex-wrap items-center gap-2" action="/admin">
          <label className="text-xs text-muted-foreground" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={fromLabel}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <label className="text-xs text-muted-foreground" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={toLabel}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Apply custom range
          </button>
        </form>
      </div>

      {/* KPI hierarchy: money first, then volume, then operational health. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Gross merchandise value"
          value={formatPrice(summary.gmv)}
          sub={`${summary.orderCount} qualifying orders`}
        />
        <KpiCard
          label="Net revenue"
          value={formatPrice(summary.netRevenue)}
          sub={`After ${formatPrice(summary.refunded)} completed refunds`}
        />
        <KpiCard
          label="Average order value"
          value={summary.averageOrderValue !== null ? formatPrice(summary.averageOrderValue) : "—"}
          sub={summary.averageOrderValue === null ? "No qualifying orders" : undefined}
        />
        <KpiCard label="Total orders" value={String(summary.orderCount)} sub="Processing, shipped, delivered" />
        <KpiCard
          label="Open inventory alerts"
          value={String(alerts.open)}
          sub={`${alerts.pending} pending · ${alerts.processing} processing`}
          href="/admin/inventory"
        />
        <KpiCard
          label="Excluded rows"
          value={String(summary.excludedNonUsdOrders)}
          sub="Non-USD orders never converted"
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Sales and revenue trend">
          <div>
            <h2 className="text-base font-semibold">Sales and revenue trend</h2>
            <p className="text-xs text-muted-foreground">Daily qualifying GMV, USD (UTC days)</p>
          </div>
          <RevenueTrendChart buckets={velocity} />
        </section>
        <section className="flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Order volume trend">
          <div>
            <h2 className="text-base font-semibold">Order volume trend</h2>
            <p className="text-xs text-muted-foreground">Orders per UTC day (all statuses)</p>
          </div>
          <OrderVolumeChart buckets={velocity} />
        </section>
        <section className="flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Order status distribution">
          <div>
            <h2 className="text-base font-semibold">Order status distribution</h2>
            <p className="text-xs text-muted-foreground">Every placed order in the period</p>
          </div>
          <DistributionChart ariaLabel="Orders by order status" items={orderStatus} />
        </section>
        <section className="flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Payment status distribution">
          <div>
            <h2 className="text-base font-semibold">Payment status distribution</h2>
            <p className="text-xs text-muted-foreground">Persisted payment states per order</p>
          </div>
          <DistributionChart ariaLabel="Orders by payment status" items={paymentStatus} />
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Top-selling products">
        <div>
          <h2 className="text-base font-semibold">Top-selling products</h2>
          <p className="text-xs text-muted-foreground">
            Units sold on qualifying orders · figures cover the whole period
          </p>
        </div>
        <TopProductsChart products={topProducts} />
      </section>

      <hr className="border-border/60" />
      <p className="text-xs text-muted-foreground">
        Definitions: GMV sums persisted order totals for processing/shipped/delivered USD orders;
        net subtracts completed refunds in-period; status charts count every order (including
        PENDING, CANCELLED) in the period; top products rank gross units sold on qualifying orders;
        metrics computed live per page load. Periods are half-open UTC days, max 90 days.
        See docs/analytics.md.
      </p>
    </div>
  );
}

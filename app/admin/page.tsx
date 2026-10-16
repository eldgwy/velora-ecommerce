import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatPrice } from "@/shared/lib/utils";
import { getDashboardDataAction } from "@/modules/analytics/presentation/actions/dashboard.actions";
import { VelocityChart } from "@/modules/analytics/presentation/components/velocity-chart";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — VELORA Admin",
};

interface DashboardPageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-foreground/10">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default async function AdminDashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const res = await getDashboardDataAction({ from: params.from, to: params.to });

  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        </div>
      </div>
    );
  }

  const { summary, velocity, alerts } = res.data;
  const fromLabel = summary.from.slice(0, 10);
  const toLabel = summary.to.slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fromLabel} → {toLabel} (UTC) · refreshed on load · {summary.currency}
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin">
        <label className="text-xs text-muted-foreground" htmlFor="from">From</label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={fromLabel}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <label className="text-xs text-muted-foreground" htmlFor="to">To</label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={toLabel}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <Button size="sm" variant="outline" type="submit">
          Filter
        </Button>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Gross merchandise value" value={formatPrice(summary.gmv)} sub={`${summary.orderCount} qualifying orders`} />
        <KpiCard label="Net revenue" value={formatPrice(summary.netRevenue)} sub={`After $${summary.refunded} completed refunds`} />
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
        />
        <KpiCard
          label="Excluded rows"
          value={String(summary.excludedNonUsdOrders)}
          sub="Non-USD orders never converted"
        />
      </div>

      <section className="rounded-xl bg-white p-5 ring-1 ring-foreground/10" aria-label="Sales velocity">
        <h2 className="mb-3 text-base font-semibold">Sales velocity (daily GMV, USD)</h2>
        <VelocityChart buckets={velocity} />
      </section>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Definitions: GMV sums persisted order totals for processing/shipped/delivered orders;
        net subtracts completed refunds in-period; metrics computed live per page load.
        See docs/analytics.md.
      </p>
    </div>
  );
}

"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/components/ui/chart";
import type {
  StatusCountBucket,
  TopSellingProduct,
  VelocityBucket,
} from "@/modules/analytics/application/queries/dashboard";

const money = (value: number) => `$${value.toFixed(2)}`;

const gmvConfig = {
  gmv: { label: "GMV (USD)", color: "var(--color-primary, #365f54)" },
} satisfies ChartConfig;

const ordersConfig = {
  orders: { label: "Orders", color: "var(--color-primary, #365f54)" },
} satisfies ChartConfig;

interface BucketDatum {
  date: string;
  fullDate: string;
  gmv?: number;
  orders?: number;
}

function toBuckets(buckets: VelocityBucket[], key: "gmv" | "orders"): BucketDatum[] {
  return buckets.map((b) => ({
    date: b.date.slice(5),
    fullDate: b.date,
    [key]: Number(key === "gmv" ? b.gmv : b.orderCount),
  }));
}

function DailyTextTable({
  rows,
  money: isMoney,
}: {
  rows: VelocityBucket[];
  money: boolean;
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
        View daily figures as text
      </summary>
      <table className="mt-2 w-full max-w-md text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Date (UTC)</th>
            <th className="py-1 text-right font-medium">{isMoney ? "GMV" : "Orders"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.date} className="border-b border-border/50 last:border-0">
              <td className="py-1 pr-2">{b.date}</td>
              <td className="py-1 text-right">{isMoney ? money(Number(b.gmv)) : b.orderCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * Sales and revenue trend (daily GMV, USD) — filled area so the total
 * revenue shape reads at a glance; order counts live in a separate chart.
 */
export function RevenueTrendChart({ buckets }: { buckets: VelocityBucket[] }) {
  if (buckets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No qualifying orders in this period — nothing to chart yet.
      </p>
    );
  }
  const data = toBuckets(buckets, "gmv");
  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={gmvConfig} className="h-60 w-full">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gmvArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-gmv)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-gmv)" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={64} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => payload[0]?.payload?.fullDate ?? ""}
                formatter={(value) => money(Number(value))}
                indicator="line"
              />
            }
          />
          <Area
            dataKey="gmv"
            type="monotone"
            fill="url(#gmvArea)"
            stroke="var(--color-gmv)"
            strokeWidth={2}
            fillOpacity={1}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ChartContainer>
      <DailyTextTable rows={buckets} money />
    </div>
  );
}

/** Order volume trend — monetary totals stay in the revenue chart above. */
export function OrderVolumeChart({ buckets }: { buckets: VelocityBucket[] }) {
  if (buckets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No orders in this period — nothing to chart yet.
      </p>
    );
  }
  const data = toBuckets(buckets, "orders");
  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={ordersConfig} className="h-60 w-full">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={48}
            allowDecimals={false}
          />
          <ChartTooltip
            cursor={{ fill: "var(--color-muted)" }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => payload[0]?.payload?.fullDate ?? ""}
                indicator="dot"
              />
            }
          />
          <Bar dataKey="orders" fill="var(--color-orders)" radius={4} />
        </BarChart>
      </ChartContainer>
      <DailyTextTable rows={buckets} money={false} />
    </div>
  );
}

/**
 * Horizontal distribution bars for persisted enum states (order lifecycle
 * and payment snapshots). Shows exclusively the states that occur in the
 * period — a genuine zero population renders the empty state, and absent
 * enum values are never fabricated.
 */
export function DistributionChart({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: StatusCountBucket[];
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No orders in this period yet.</p>
    );
  }
  const data = items.map((i) => ({ status: i.status, count: i.count }));
  const config = {
    count: { label: "Orders", color: "var(--color-primary, #365f54)" },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="h-56 w-full" aria-hidden={false}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 8, left: 8 }}
        role="img"
        aria-label={ariaLabel}
      >
        <CartesianGrid horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="status"
          tickLine={false}
          axisLine={false}
          width={116}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)" }}
          content={<ChartTooltipContent indicator="dot" />}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} barSize={18} />
      </BarChart>
    </ChartContainer>
  );
}

/** Top-selling products (units sold) with persisted net sales in the tooltip. */
export function TopProductsChart({ products }: { products: TopSellingProduct[] }) {
  if (products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No qualifying orders in this period — no product rankings yet.
      </p>
    );
  }
  const data = products.map((p) => ({
    sku: p.sku,
    name: p.productName ?? p.sku,
    units: p.unitsSold,
    netSales: p.netSales,
  }));
  const config = {
    units: { label: "Units sold", color: "var(--color-primary, #365f54)" },
  } satisfies ChartConfig;
  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 8, left: 8 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            width={150}
            tick={{ fontSize: 11 }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--color-muted)" }}
            content={
              <ChartTooltipContent
                formatter={(value, _name, item) => {
                  const row = item?.payload as { units: number; netSales: string } | undefined;
                  return `${value} units · $${row?.netSales ?? "0.00"}`;
                }}
                indicator="dot"
              />
            }
          />
          <Bar dataKey="units" fill="var(--color-units)" radius={4} barSize={18} />
        </BarChart>
      </ChartContainer>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
          View product figures as text
        </summary>
        <table className="mt-2 w-full max-w-md text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">SKU</th>
              <th className="py-1 pr-2 text-right font-medium">Units</th>
              <th className="py-1 text-right font-medium">Net sales</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.sku} className="border-b border-border/50 last:border-0">
                <td className="py-1 pr-2 font-mono text-xs">{p.sku}</td>
                <td className="py-1 pr-2 text-right">{p.unitsSold}</td>
                <td className="py-1 text-right">{money(Number(p.netSales))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/components/ui/chart";
import type { VelocityBucket } from "@/modules/analytics/application/queries/dashboard";

const config = {
  gmv: { label: "GMV (USD)", color: "var(--color-primary, #365f54)" },
} satisfies ChartConfig;

/**
 * Daily GMV bars with accessible text fallback (table below carries the
 * same values for assistive technology).
 */
export function VelocityChart({ buckets }: { buckets: VelocityBucket[] }) {
  if (buckets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No qualifying orders in this period — nothing to chart yet.
      </p>
    );
  }
  const data = buckets.map((b) => ({ date: b.date.slice(5), fullDate: b.date, gmv: Number(b.gmv), orders: b.orderCount }));
  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={config} className="h-64 w-full">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={64} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => payload[0]?.payload?.fullDate ?? ""}
              />
            }
          />
          <Bar dataKey="gmv" fill="var(--color-gmv)" radius={4} />
        </BarChart>
      </ChartContainer>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
          View daily figures as text
        </summary>
        <table className="mt-2 w-full max-w-md text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Date (UTC)</th>
              <th className="py-1 pr-2 text-right font-medium">GMV</th>
              <th className="py-1 text-right font-medium">Orders</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.date} className="border-b border-border/50 last:border-0">
                <td className="py-1 pr-2">{b.date}</td>
                <td className="py-1 pr-2 text-right">${b.gmv}</td>
                <td className="py-1 text-right">{b.orderCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

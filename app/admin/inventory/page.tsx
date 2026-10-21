import { EmptyState } from "@/shared/components/ui/empty-state";

import {
  findCurrentlyLowStockVariants,
  getLowStockAlertStats,
} from "@/modules/inventory/application/low-stock-alerts";
import {
  getInventoryConsoleList,
  INVENTORY_PAGE_SIZE,
} from "@/modules/inventory/application/queries/inventory-console";
import { InventoryAdjustForm } from "@/modules/inventory/presentation/components/inventory-adjust-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Inventory — VELORA Admin",
};

interface InventoryPageProps {
  searchParams: Promise<{ q?: string; alert?: string; page?: string }>;
}

/**
 * Inventory console (T-2.2): alert stats, currently-low variants, and a
 * searchable stock list driving the adjustInventory action (reason forced).
 * Reads are batched (single join query + two aggregate reads); conservative
 * search is escaped before ILIKE.
 */
export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const [alertStats, lowStock] = await Promise.all([
    getLowStockAlertStats(),
    findCurrentlyLowStockVariants(),
  ]);
  const list = await getInventoryConsoleList({
    q,
    alertLow: params.alert === "low",
    page,
    lowVariantIds: lowStock.map((l) => l.variantId),
  });

  const total = list.total;
  const rows = list.rows;
  const totalPages = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
  const lowVariantIds = new Set(lowStock.map((l) => l.variantId));
  const lowNames = list.lowNames;

  const pageHref = (p: number) =>
    `/admin/inventory?${new URLSearchParams({ ...(q ? { q } : {}), ...(params.alert ? { alert: params.alert } : {}), page: String(p) }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} stock record{total === 1 ? "" : "s"} · every change is audited with your admin id
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {[
          { label: "Pending alerts", value: alertStats.pending },
          { label: "Processing", value: alertStats.processing },
          { label: "Delivered", value: alertStats.delivered },
          { label: "Failed", value: alertStats.failed },
          { label: "Total", value: alertStats.total },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <p className="text-2xl font-semibold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {lowStock.length > 0 ? (
        <section className="rounded-xl bg-card p-5 ring-1 ring-amber-300/60">
          <h2 className="text-base font-semibold text-amber-800">Low stock now ({lowStock.length})</h2>
          <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
            {lowStock.map((l) => {
              const v = lowNames.get(l.variantId);
              return (
                <li key={l.variantId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200/70 px-2 py-1.5">
                  <span>
                    <span className="font-medium">{v?.productName ?? "Variant"}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{v?.sku ?? "—"}</span>                  </span>
                  <span className="text-xs font-semibold text-amber-800">
                    available {l.availableStock} / threshold {l.threshold}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/inventory">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search product, SKU…"
          aria-label="Search inventory"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="alert" value="low" defaultChecked={params.alert === "low"} className="size-4" />
          Only low-stock
        </label>
        <button type="submit" className="rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No stock records match" description="Variants appear here once their inventory rows are created." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const available = r.quantity - r.reservedQuantity;
            const isLow = lowVariantIds.has(r.variantId);
            return (
              <div key={r.variantId} className={`flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ${isLow ? "ring-amber-300/60" : "ring-foreground/10"}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{r.productName}</span>
                  <span className="text-xs text-muted-foreground">{r.sku ?? r.variantId}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    on hand {r.quantity} · reserved {r.reservedQuantity} ·{" "}
                    <span className={available <= 0 ? "font-semibold text-red-700" : isLow ? "font-semibold text-amber-700" : ""}>
                      available {available}
                    </span>
                    {r.lowStockThreshold !== null ? ` · threshold ${r.lowStockThreshold}` : ""}
                  </span>
                </div>
                <InventoryAdjustForm variantId={r.variantId} label={`${r.productName} · ${r.sku ?? ""}`} />
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page > 1 ? <a href={pageHref(page - 1)} className="rounded-lg border border-border bg-card px-3 py-1.5 hover:bg-muted">← Prev</a> : null}
          {page < totalPages ? <a href={pageHref(page + 1)} className="rounded-lg border border-border bg-card px-3 py-1.5 hover:bg-muted">Next →</a> : null}
        </div>
      ) : null}
    </div>
  );
}

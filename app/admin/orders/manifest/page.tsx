import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { PrintButton } from "@/modules/orders/presentation/components/print-button";
import { getShippingManifestAction } from "@/modules/orders/presentation/actions/admin-order.actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shipping manifest — VELORA Admin",
  robots: { index: false, follow: false },
};

interface ManifestPageProps {
  searchParams: Promise<{ ids?: string }>;
}

/**
 * Print-friendly shipping manifest for explicitly selected orders.
 * Only PROCESSING/SHIPPED orders print; anything else is listed as
 * excluded with its reason. Screen shows admin chrome; print output
 * carries only the manifests (print stylesheet below).
 */
export default async function ManifestPage({ searchParams }: ManifestPageProps) {
  const params = await searchParams;
  const ids = (params.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 50);
  if (ids.length === 0) notFound();

  const res = await getShippingManifestAction({ orderIds: ids });
  if (!res.ok || !res.data) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">Shipping manifest</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        <Button size="sm" variant="outline" render={<Link href="/admin/orders">Back to orders</Link>} />
      </div>
    );
  }

  const { included, excluded } = res.data;

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print {
        body * { visibility: hidden; }
        #manifest-print, #manifest-print * { visibility: visible; }
        #manifest-print { position: absolute; inset: 0; }
        .manifest-page { break-after: page; box-shadow: none !important; border: 1px solid #ccc !important; }
        .manifest-page:last-child { break-after: auto; }
      }`}</style>

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Shipping manifest</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {included.length} included · {excluded.length} excluded
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" render={<Link href="/admin/orders">Back to orders</Link>} />
          <PrintButton />
        </div>
      </div>

      {excluded.length > 0 ? (
        <div className="rounded-xl bg-white p-4 text-sm ring-1 ring-foreground/10 print:hidden">
          <h2 className="font-semibold">Excluded selections</h2>
          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
            {excluded.map((e) => (
              <li key={e.orderId}>
                <span className="font-mono text-xs">{e.orderId.slice(0, 8)}…</span> — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {included.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">
            None of the selected orders are shippable right now.
          </p>
        </div>
      ) : (
        <div id="manifest-print" className="flex flex-col gap-5">
          {included.map((order) => (
            <article
              key={order.orderId}
              className="manifest-page rounded-xl bg-white p-6 ring-1 ring-foreground/10"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    VELORA · Shipping manifest
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">{order.orderNumber}</h2>
                  <p className="text-xs text-muted-foreground">Status: {order.status}</p>
                </div>
                <p className="text-sm font-medium">{order.customerName ?? "—"}</p>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Ship to
                  </h3>
                  {order.address ? (
                    <address className="mt-1 text-sm not-italic">
                      {[order.address.firstName, order.address.lastName].filter(Boolean).join(" ") || "—"}
                      <br />
                      {order.address.addressLine1 ?? ""}
                      <br />
                      {order.address.addressLine2 ? (
                        <>
                          {order.address.addressLine2}
                          <br />
                        </>
                      ) : null}
                      {[order.address.city, order.address.state, order.address.postalCode]
                        .filter(Boolean)
                        .join(", ")}
                      <br />
                      {order.address.country ?? ""}
                      <br />
                      {order.address.phone ? `Tel: ${order.address.phone}` : ""}
                    </address>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">No shipping address on file.</p>
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Contents
                  </h3>
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {order.items.length === 0 ? (
                      <li className="text-muted-foreground">No items recorded.</li>
                    ) : (
                      order.items.map((item, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>
                            {item.productName ?? "Item"}
                            {item.variantName ? ` · ${item.variantName}` : ""}
                            <span className="text-muted-foreground"> × {item.quantity}</span>
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {item.sku}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>

              {order.notes ? (
                <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
                  <span className="font-semibold">Instructions: </span>
                  {order.notes}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

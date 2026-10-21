import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { getCouponDetailAction } from "@/modules/coupons/presentation/actions/coupon-admin.actions";
import { CouponForm } from "@/modules/coupons/presentation/components/coupon-form";
import { CouponActiveToggle } from "@/modules/coupons/presentation/components/coupon-active-toggle";
import { CouponStatusBadge } from "@/modules/coupons/presentation/components/coupon-status-badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Coupon details — VELORA Admin",
};

interface CouponDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CouponDetailPage({ params }: CouponDetailPageProps) {
  const { id } = await params;
  const res = await getCouponDetailAction(id);
  if (!res.ok || !res.data) {
    if (!res.ok && res.error === "Coupon not found.") notFound();
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load that coupon</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        <Button size="lg" render={<Link href="/admin/coupons">Back to coupons</Link>} />
      </div>
    );
  }

  const coupon = res.data;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/admin/coupons">← All coupons</Link>} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{coupon.code}</h1>
          <CouponStatusBadge status={coupon.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {coupon.type === "PERCENTAGE" ? `${coupon.value}%` : `$${coupon.value}`} · used{" "}
          {coupon.usageCount}
          {coupon.usageLimit !== null ? ` of ${coupon.usageLimit}` : ""}
          {coupon.perUserLimit !== null ? ` · max ${coupon.perUserLimit} per customer` : ""}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <section aria-label="Edit coupon">
            <h2 className="mb-3 text-base font-semibold">Configuration</h2>
            <CouponForm initial={coupon} />
          </section>

          <section
            className="rounded-xl bg-card p-5 ring-1 ring-foreground/10"
            aria-label="Redemption history"
          >
            <h2 className="mb-3 text-base font-semibold">
              Redemptions ({coupon.usages.length})
            </h2>
            {coupon.usages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No redemptions recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {coupon.usages.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {u.orderNumber ? (
                        <Link
                          href={`/admin/orders/${u.orderId}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {u.orderNumber}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Order removed</span>
                      )}
                      <span className="text-muted-foreground"> · −${u.discountAmount ?? "?"}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section
            className="rounded-xl bg-card p-5 text-sm ring-1 ring-foreground/10"
            aria-label="Activation"
          >
            <h2 className="mb-2 text-base font-semibold">Activation</h2>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Starts</dt>
                <dd>{coupon.startsAt ? formatDate(new Date(coupon.startsAt)) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Expires</dt>
                <dd>{coupon.expiresAt ? formatDate(new Date(coupon.expiresAt)) : "—"}</dd>
              </div>
            </dl>
            <Separator className="my-3" />
            <CouponActiveToggle id={coupon.id} isActive={coupon.isActive} />
          </section>
        </div>
      </div>
    </div>
  );
}

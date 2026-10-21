import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { getPromotionDetailAction } from "@/modules/promotions/presentation/actions/promotion-admin.actions";
import { PromotionForm } from "@/modules/promotions/presentation/components/promotion-form";
import { PromotionActiveToggle } from "@/modules/promotions/presentation/components/promotion-active-toggle";
import { PromotionProductMapper } from "@/modules/promotions/presentation/components/promotion-product-mapper";
import { PromotionStatusBadge } from "@/modules/promotions/presentation/components/promotion-status-badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Promotion details — VELORA Admin",
};

interface PromotionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PromotionDetailPage({ params }: PromotionDetailPageProps) {
  const { id } = await params;
  const res = await getPromotionDetailAction(id);
  if (!res.ok || !res.data) {
    if (!res.ok && res.error === "Promotion not found.") notFound();
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load that promotion</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        <Button size="lg" render={<Link href="/admin/promotions">Back to promotions</Link>} />
      </div>
    );
  }

  const promotion = res.data;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/admin/promotions">← All promotions</Link>} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{promotion.name}</h1>
          <PromotionStatusBadge status={promotion.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {promotion.type === "PERCENTAGE" ? `${promotion.value}%` : `$${promotion.value}`} off ·{" "}
          {promotion.productCount} product{promotion.productCount === 1 ? "" : "s"} mapped
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <section aria-label="Edit promotion">
            <h2 className="mb-3 text-base font-semibold">Configuration</h2>
            <PromotionForm initial={promotion} />
          </section>

          <section
            className="rounded-xl bg-card p-5 ring-1 ring-foreground/10"
            aria-label="Mapped products"
          >
            <h2 className="mb-3 text-base font-semibold">Eligible products</h2>
            <PromotionProductMapper promotionId={promotion.id} mapped={promotion.mappedProducts} />
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section
            className="rounded-xl bg-card p-5 text-sm ring-1 ring-foreground/10"
            aria-label="Schedule and activation"
          >
            <h2 className="mb-2 text-base font-semibold">Schedule</h2>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Starts</dt>
                <dd>{promotion.startsAt ? formatDate(new Date(promotion.startsAt)) : "Immediately"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Ends</dt>
                <dd>{promotion.endsAt ? formatDate(new Date(promotion.endsAt)) : "Open-ended"}</dd>
              </div>
            </dl>
            <Separator className="my-3" />
            <PromotionActiveToggle id={promotion.id} isActive={promotion.isActive} />
          </section>
        </div>
      </div>
    </div>
  );
}

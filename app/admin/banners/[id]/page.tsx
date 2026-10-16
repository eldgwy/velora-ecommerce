import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { getBannerDetailAction } from "@/modules/banners/presentation/actions/banner-admin.actions";
import { BannerForm } from "@/modules/banners/presentation/components/banner-form";
import { BannerDeleteButton } from "@/modules/banners/presentation/components/banner-delete-button";
import { BannerStatusBadge } from "@/modules/banners/presentation/components/banner-status-badge";
import { transitionBannerStatusAction } from "@/modules/banners/presentation/actions/banner-admin.actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Banner details — VELORA Admin",
};

interface BannerDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function BannerDetailPage({ params }: BannerDetailPageProps) {
  const { id } = await params;
  const res = await getBannerDetailAction(id);
  if (!res.ok || !res.data) {
    if (!res.ok && res.error === "Banner not found.") notFound();
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load that banner</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        <Button size="lg" render={<Link href="/admin/banners">Back to banners</Link>} />
      </div>
    );
  }

  const banner = res.data;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/admin/banners">← All banners</Link>} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{banner.title}</h1>
          <BannerStatusBadge status={banner.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {banner.startsAt ? formatDate(new Date(banner.startsAt)) : "No start bound"}
          {" → "}
          {banner.endsAt ? formatDate(new Date(banner.endsAt)) : "open-ended"}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <section aria-label="Edit banner">
            <h2 className="mb-3 text-base font-semibold">Content & schedule</h2>
            <BannerForm initial={banner} />
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section
            className="rounded-xl bg-white p-5 text-sm ring-1 ring-foreground/10"
            aria-label="Publication"
          >
            <h2 className="mb-2 text-base font-semibold">Publication</h2>
            <p className="text-xs text-muted-foreground">
              Only ACTIVE banners inside their time window reach the storefront carousel.
            </p>
            <Separator className="my-3" />
            <PublishControls id={banner.id} status={banner.status} />
          </section>
          <section
            className="rounded-xl bg-white p-5 text-sm ring-1 ring-foreground/10"
            aria-label="Danger zone"
          >
            <h2 className="mb-2 text-base font-semibold">Danger zone</h2>
            <BannerDeleteButton id={banner.id} title={banner.title} />
          </section>
        </div>
      </div>
    </div>
  );
}

function PublishControls({ id, status }: { id: string; status: string }) {
  return (
    <form
      action={async (form: FormData) => {
        "use server";
        const to = String(form.get("to") ?? "");
        if (to !== "ACTIVE" && to !== "DRAFT" && to !== "EXPIRED" && to !== "SCHEDULED") return;
        await transitionBannerStatusAction({ id, to });
      }}
      className="flex flex-wrap gap-2"
    >
      {(["DRAFT", "SCHEDULED", "ACTIVE", "EXPIRED"] as const)
        .filter((s) => s !== status)
        .map((s) => (
          <Button key={s} size="sm" variant="outline" type="submit" name="to" value={s}>
            → {s}
          </Button>
        ))}
    </form>
  );
}

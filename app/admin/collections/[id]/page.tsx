import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { getCollectionDetailAction } from "@/modules/collections/presentation/actions/collection-admin.actions";
import { CollectionForm } from "@/modules/collections/presentation/components/collection-form";
import { CollectionActiveToggle } from "@/modules/collections/presentation/components/collection-active-toggle";
import { CollectionProductManager } from "@/modules/collections/presentation/components/collection-product-manager";
import { CollectionStatusBadge } from "@/modules/collections/presentation/components/collection-status-badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Collection details — VELORA Admin",
};

interface CollectionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CollectionDetailPage({ params }: CollectionDetailPageProps) {
  const { id } = await params;
  const res = await getCollectionDetailAction(id);
  if (!res.ok || !res.data) {
    if (!res.ok && res.error === "Collection not found.") notFound();
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load that collection</h1>
        <p className="text-sm text-muted-foreground">{res.ok ? "Please try again." : res.error}</p>
        <Button size="lg" render={<Link href="/admin/collections">Back to collections</Link>} />
      </div>
    );
  }

  const collection = res.data;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/admin/collections">← All collections</Link>} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{collection.name}</h1>
          <CollectionStatusBadge isActive={collection.isActive} />
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">/{collection.slug}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <section aria-label="Edit collection">
            <h2 className="mb-3 text-base font-semibold">Configuration</h2>
            <CollectionForm initial={collection} />
          </section>

          <section
            className="rounded-xl bg-white p-5 ring-1 ring-foreground/10"
            aria-label="Mapped products"
          >
            <h2 className="mb-3 text-base font-semibold">Products in order</h2>
            <CollectionProductManager collectionId={collection.id} mapped={collection.mappedProducts} />
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section
            className="rounded-xl bg-white p-5 text-sm ring-1 ring-foreground/10"
            aria-label="Publication"
          >
            <h2 className="mb-2 text-base font-semibold">Publication</h2>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Products</dt>
                <dd>{collection.productCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{formatDate(new Date(collection.updatedAt))}</dd>
              </div>
            </dl>
            <Separator className="my-3" />
            <CollectionActiveToggle id={collection.id} isActive={collection.isActive} />
          </section>
        </div>
      </div>
    </div>
  );
}

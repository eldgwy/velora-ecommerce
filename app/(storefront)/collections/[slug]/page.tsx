import { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCurrentSession } from "@/shared/lib/guards";
import { getSavedProductIds } from "@/modules/wishlist/application/queries/wishlist";
import { getProductPromotionSummaries } from "@/modules/promotions/application/queries/promotion-pricing";
import { ProductCard } from "@/shared/components/product/ProductCard";
import {
  getCollectionCards,
  getPublicCollectionBySlug,
} from "@/modules/collections/application/queries/collections";

export const dynamic = "force-dynamic";

interface CollectionPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CollectionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getPublicCollectionBySlug(slug);
  if (!collection) return { title: "Collection not found" };
  return {
    title: collection.name,
    description: collection.description ?? undefined,
  };
}

export default async function CollectionDetailPage({ params }: CollectionPageProps) {
  const { slug } = await params;
  const collection = await getPublicCollectionBySlug(slug);
  if (!collection) notFound();

  // Ordered cards in one batched pass (products, images, brands, prices,
  // ratings) plus batched wishlist state and promotion summaries.
  const orderedIds = collection.products.map((p) => p.productId);
  const [cards, session] = await Promise.all([
    getCollectionCards(orderedIds),
    getCurrentSession(),
  ]);
  const [savedIds, promoSummaries] = await Promise.all([
    session ? getSavedProductIds(session.user.id, orderedIds) : new Set<string>(),
    getProductPromotionSummaries(orderedIds),
  ]);

  return (
    <div className="container mx-auto px-4 py-8">
      {collection.image ? (
        <div className="relative aspect-[21/9] overflow-hidden rounded-xl bg-muted">
          {/* Remote cover URL (same pattern as catalog product imagery). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={collection.image}
            alt={collection.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="mt-6">
        <h1 className="text-3xl font-bold tracking-tight">{collection.name}</h1>
        {collection.description ? (
          <p className="mt-2 max-w-2xl text-muted-foreground">{collection.description}</p>
        ) : null}
        <p className="mt-1 text-sm text-muted-foreground">
          {cards.length} product{cards.length === 1 ? "" : "s"}
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="mt-8 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">
            This collection has no available products right now.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((card) => (
            <ProductCard
              key={card.id}
              product={card}
              initialSaved={savedIds.has(card.id)}
              promotion={promoSummaries.get(card.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

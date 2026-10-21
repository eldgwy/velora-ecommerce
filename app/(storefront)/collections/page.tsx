import Link from "next/link";
import Image from "next/image";

import { listPublicCollections } from "@/modules/collections/application/queries/collections";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Collections",
  description: "Curated product collections from VELORA.",
};

export default async function CollectionsPage() {
  const items = await listPublicCollections();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Collections</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Curated edits from our store team.
      </p>

      {items.length === 0 ? (
        <div className="mt-8 rounded-xl bg-white px-6 py-16 text-center ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">
            No collections right now — check back soon.
          </p>
          <Link
            href="/products"
            className="mt-4 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
          >
            Browse products
          </Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/collections/${c.slug}`} className="group block">
                <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-muted">
                  {c.image ? (
                    // Remote cover URL (Cloudinary is allowlisted in images.remotePatterns).
                    <Image
                      src={c.image}
                      alt={c.name}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      VELORA
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <h2 className="text-lg font-semibold group-hover:text-primary group-hover:underline group-hover:underline-offset-4">
                    {c.name}
                  </h2>
                  {c.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.productCount} product{c.productCount === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

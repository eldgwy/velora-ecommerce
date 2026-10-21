"use client";

import { useState } from "react";
import Image from "next/image";

import { cn } from "@/shared/lib/utils";

interface ProductImage {
  id: string;
  url: string;
  alt: string | null;
  isPrimary: boolean;
}

interface ProductGalleryProps {
  images: ProductImage[];
  productName: string;
}

/**
 * Client gallery so thumbnail selection updates the main image. The primary
 * image is the default selection; selecting a thumbnail is purely visual
 * state and does not mutate anything server-side.
 */
export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    images.find((i) => i.isPrimary)?.id ?? null,
  );

  if (images.length === 0) {
    return (
      <div className="aspect-square relative rounded-lg overflow-hidden bg-muted">
        <div className="flex h-full items-center justify-center text-muted-foreground">
          No Image
        </div>
      </div>
    );
  }

  const selected = images.find((i) => i.id === selectedId) ?? images[0];
  // Empty gallery falls back to the CSS placeholder background rather than
  // dereferencing an undefined image row.
  if (!selected) return null;

  return (
    <div className="space-y-4">
      <div className="aspect-square relative rounded-lg overflow-hidden bg-muted">
        <Image
          src={selected.url}
          alt={selected.alt ?? productName}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              aria-label={`Show image: ${image.alt ?? productName}`}
              aria-pressed={image.id === selectedId}
              onClick={() => setSelectedId(image.id)}
              className={cn(
                "flex-shrink-0 aspect-square w-20 rounded overflow-hidden border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                image.id === selectedId
                  ? "border-primary"
                  : "border-transparent hover:border-accent",
              )}
            >
              <Image
                src={image.url}
                alt=""
                width={80}
                height={80}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProductGallery;

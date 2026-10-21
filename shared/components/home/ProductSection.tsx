"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import {
  ProductCard,
  type CardDisplayCurrency,
  type ProductCardProduct,
  type ProductCardPromotion,
} from "@/shared/components/product/ProductCard";

gsap.registerPlugin(ScrollTrigger);

/**
 * Home merchandising section shell (GP-02): the section keeps the luxury
 * heading treatment and a light scroll entrance animation, while the cards
 * themselves are the shared `ProductCard` — the same card used on listings
 * and collections, so price/promotion/wishlist semantics cannot drift on
 * the most-visited page (§10: no placeholder controls, no fabricated data).
 *
 * Empty sections render nothing: home merchandising is never faked with
 * placeholder products when the catalog has no visible items yet.
 */
export interface ProductSectionProps {
  eyebrow: string;
  title: string;
  description?: string;
  products: ProductCardProduct[];
  /** Saved (wishlisted) product ids, batched by the server page. */
  savedIds?: string[];
  promotions?: Record<string, ProductCardPromotion | null | undefined>;
  display?: CardDisplayCurrency | null;
  viewAllHref?: string;
  viewAllLabel?: string;
}

export function ProductSection({
  eyebrow,
  title,
  description,
  products,
  savedIds,
  promotions,
  display,
  viewAllHref = "/products",
  viewAllLabel = "View All",
}: ProductSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;
      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const heading = section.querySelector<HTMLElement>(".section-heading");
      const cards = gsap.utils.toArray<HTMLElement>(".product-card");
      if (cards.length === 0) return;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
          invalidateOnRefresh: true,
        },
      });

      if (heading) {
        tl.fromTo(
          heading,
          { y: 48, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.3, ease: "power2.out" },
          0,
        );
      }

      tl.fromTo(
        cards,
        { y: 110, opacity: 0, scale: 0.97 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.35,
          stagger: 0.06,
          ease: "power2.out",
        },
        0.05,
      );

      tl.to(
        cards,
        {
          y: -48,
          opacity: 0,
          duration: 0.3,
          stagger: 0.03,
          ease: "power2.in",
        },
        0.75,
      );
    },
    { scope: sectionRef },
  );

  if (products.length === 0) return null;

  return (
    <section ref={sectionRef} className="px-4 py-16 md:px-6 lg:py-24">
      <div className="mx-auto max-w-360">
        <div className="section-heading mb-8 flex items-end justify-between">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
              {eyebrow}
            </p>

            <h2 className="font-display text-3xl tracking-tight md:text-4xl">
              {title}
            </h2>

            {description ? (
              <p className="mt-3 max-w-md text-xs leading-6 text-muted-foreground md:text-sm">
                {description}
              </p>
            ) : null}
          </div>

          {viewAllHref ? (
            <Link
              href={viewAllHref}
              className="group hidden items-center gap-2 text-xs font-medium uppercase tracking-wider md:flex"
            >
              <span>{viewAllLabel}</span>

              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-10">
          {products.map((product) => (
            <div key={product.id} className="product-card min-w-0">
              <ProductCard
                product={product}
                initialSaved={savedIds?.includes(product.id) ?? false}
                promotion={promotions?.[product.id] ?? null}
                display={display}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

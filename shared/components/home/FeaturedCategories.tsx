"use client";

import { useRef } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Featured categories (GP-02): driven by the effective-visible category
 * tree (server-fetched). Category rows carry no imagery columns in the
 * schema, so cards render the established secondary-surface treatment —
 * an explicit visual state, not a fabricated photo. Links point at the
 * real category route (`/categories/[slug]`).
 *
 * Empty tree renders nothing rather than a fabricated section.
 */
const FeaturedCategories = ({
  categories,
}: {
  categories: Array<{ name: string; slug: string }>;
}) => {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;
      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const heading = section.querySelector<HTMLElement>(".category-heading");
      const cards = gsap.utils.toArray<HTMLElement>(".category-card");
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
          { y: 56, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.3, ease: "power2.out" },
          0,
        );
      }

      tl.fromTo(
        cards,
        {
          y: 130,
          opacity: 0,
          scale: 0.95,
          rotate: (index) => (index % 2 === 0 ? -1 : 1),
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          rotate: 0,
          duration: 0.35,
          stagger: 0.07,
          ease: "power2.out",
        },
        0.05,
      );

      tl.to(
        cards,
        {
          y: -60,
          opacity: 0,
          duration: 0.3,
          stagger: 0.05,
          ease: "power2.in",
        },
        0.75,
      );
    },
    { scope: sectionRef },
  );

  if (categories.length === 0) return null;

  return (
    <section ref={sectionRef} className="px-4 py-20 md:px-8 lg:py-28">
      <div className="mx-auto max-w-360">
        {/* Section Header */}
        <div className="category-heading mb-10 flex items-end justify-between">
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-primary">
              Explore
            </p>

            <h2 className="font-display text-4xl tracking-tight md:text-5xl">
              Shop by Category
            </h2>
          </div>

          <Link
            href="/products"
            className="hidden text-sm font-medium transition-colors hover:text-primary md:block"
          >
            View All →
          </Link>
        </div>

        {/* Categories */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className="category-card group relative overflow-hidden rounded-2xl"
            >
              <div className="relative aspect-4/5 overflow-hidden bg-secondary">
                {/* Categories carry no imagery columns; the name-monogram
                    surface is the explicit no-photography state. */}
                <div className="absolute inset-0 flex items-start justify-start p-5">
                  <span className="font-display text-5xl text-white/15 md:text-6xl">
                    {category.name.charAt(0)}
                  </span>
                </div>

                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent transition-colors duration-500 group-hover:from-black/40" />

                {/* Content */}
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <h3 className="font-display text-2xl text-white md:text-3xl">
                    {category.name}
                  </h3>

                  <span className="mt-1 block text-sm text-white/80 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    Explore Collection →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Mobile View All */}
        <Link href="/products" className="mt-6 block text-sm font-medium md:hidden">
          View All Categories →
        </Link>
      </div>
    </section>
  );
};

export default FeaturedCategories;

"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Heart,
  ShoppingBag,
  Star,
  Eye,
} from "lucide-react";

import { Products as ProductsList, type Product } from "@/constants";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/all";

const Products = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.registerPlugin(ScrollTrigger);

      const section = sectionRef.current;
      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const heading = section.querySelector<HTMLElement>(".products-heading");
      const cards = gsap.utils.toArray<HTMLElement>(".product-card");
      const images = gsap.utils.toArray<HTMLElement>(".product-image");

      /*
       * =========================
       * MASTER SCROLL TIMELINE
       * =========================
       */

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
          invalidateOnRefresh: true,
        },
      });

      /*
       * =========================
       * HEADING ENTER
       * =========================
       */

      if (heading) {
        tl.fromTo(
          heading,
          {
            y: 40,
            opacity: 0,
          },
          {
            y: 0,
            opacity: 1,
            duration: 0.25,
            ease: "power2.out",
          },
          0,
        );
      }

      /*
       * =========================
       * PRODUCT CARDS ENTER
       * =========================
       */

      tl.fromTo(
        cards,
        {
          y: 100,
          opacity: 0,
          scale: 0.94,
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.4,
          stagger: 0.06,
          ease: "power3.out",
        },
        0.05,
      );

      /*
       * =========================
       * IMAGE REVEAL
       * =========================
       */

      tl.fromTo(
        images,
        {
          scale: 1.15,
        },
        {
          scale: 1,
          duration: 0.5,
          stagger: 0.06,
          ease: "power2.out",
        },
        0,
      );

      /*
       * =========================
       * HOLD
       * =========================
       */

      /*
       * Cards remain stable here.
       *
       * This creates breathing room between
       * the enter and exit animations.
       */

      /*
       * =========================
       * EXIT
       * =========================
       */

      tl.to(
        cards,
        {
          x: -70,
          y: -20,
          opacity: 0,
          scale: 0.96,
          duration: 0.3,
          stagger: 0.05,
          ease: "power2.in",
        },
        0.72,
      );

      /*
       * =========================
       * HEADING EXIT
       * =========================
       */

      if (heading) {
        tl.to(
          heading,
          {
            x: -40,
            opacity: 0,
            duration: 0.25,
            ease: "power2.in",
          },
          0.75,
        );
      }

      /*
       * =========================
       * IMAGE EXIT
       * =========================
       */

      tl.to(
        images,
        {
          scale: 1.08,
          duration: 0.3,
          stagger: 0.04,
          ease: "power2.in",
        },
        0.72,
      );
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} className="px-4 py-16 md:px-6 lg:py-24">
      <div className="mx-auto max-w-360">
        {/* Header */}
        <div className="products-heading mb-8 flex items-end justify-between">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
              Curated Selection
            </p>

            <h2 className="font-display text-3xl tracking-tight md:text-4xl">
              Best Products
            </h2>
          </div>

          <Link
            href="/shop"
            className="group hidden items-center gap-2 text-xs font-medium uppercase tracking-wider md:flex"
          >
            <span>View All</span>

            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-10">
          {ProductsList.map((product: Product) => (
            <article key={product.id} className="product-card group min-w-0">
              {/* Product Image */}
              <div className="relative overflow-hidden rounded-xl bg-surface-muted">
                <Link href={`/products/${product.id}`}>
                  <div className="relative aspect-4/5 product-image">
                    <Image
                      src={product.image || "/images/product-placeholder.jpg"}
                      alt={product.title}
                      fill
                      sizes="
                        (max-width: 640px) 50vw,
                        (max-width: 1024px) 33vw,
                        25vw
                      "
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                    />

                    {/* Subtle Overlay */}
                    <div className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-black/5" />
                  </div>
                </Link>

                {/* Category */}
                <span className="absolute left-2.5 top-2.5 rounded-full border border-white/50 bg-white/75 px-2.5 py-1 text-[9px] font-medium uppercase tracking-wider text-foreground backdrop-blur-md">
                  {product.category}
                </span>

                {/* Wishlist */}
                <button
                  type="button"
                  aria-label={`Add ${product.title} to wishlist`}
                  className="
                    absolute right-2.5 top-2.5
                    flex size-8 items-center justify-center
                    rounded-full
                    border border-white/50
                    bg-white/75
                    text-foreground
                    backdrop-blur-md
                    transition-all
                    duration-300
                    hover:scale-105
                    hover:bg-white
                    hover:text-red-500
                  "
                >
                  <Heart className="size-3.5" />
                </button>

                {/* Quick Actions */}
                <div
                  className="
                    absolute bottom-3 left-1/2
                    flex -translate-x-1/2 translate-y-3
                    items-center gap-1.5
                    opacity-0
                    transition-all duration-300
                    group-hover:translate-y-0
                    group-hover:opacity-100
                  "
                >
                  {/* Quick View */}
                  <Link
                    href={`/products/${product.id}`}
                    aria-label={`Quick view ${product.title}`}
                    className="
                      flex size-8 items-center justify-center
                      rounded-full
                      bg-white/90
                      text-foreground
                      shadow-sm
                      backdrop-blur-md
                      transition-colors
                      hover:bg-white
                      hover:text-primary
                    "
                  >
                    <Eye className="size-3.5" />
                  </Link>

                  {/* Product */}
                  <Link
                    href={`/products/${product.id}`}
                    aria-label={`View ${product.title}`}
                    className="
                      flex size-8 items-center justify-center
                      rounded-full
                      bg-white/90
                      text-foreground
                      shadow-sm
                      backdrop-blur-md
                      transition-colors
                      hover:bg-white
                      hover:text-primary
                    "
                  >
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </div>

              {/* Product Info */}
              <div className="pt-3">
                {/* Title + Price */}
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/products/${product.id}`} className="min-w-0">
                    <h3 className="truncate text-sm font-medium transition-colors duration-300 hover:text-primary">
                      {product.title}
                    </h3>
                  </Link>

                  <span className="shrink-0 text-xs font-semibold">
                    ${product.price}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  {/* Description */}
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {product.description}
                  </p>

                  {/* Bottom Row */}
                  <div className="mt-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, index) => {
                        const rating = product.stars || 0;
                        const fillPercentage = Math.min(
                          Math.max((rating - index) * 100, 0),
                          100,
                        );

                        return (
                          <div key={index} className="relative size-3">
                            {/* Empty star */}
                            <Star className="absolute inset-0 size-3 fill-transparent text-border" />

                            {/* Filled part */}
                            <div
                              className="absolute inset-0 overflow-hidden"
                              style={{ width: `${fillPercentage}%` }}
                            >
                              <Star className="size-3 fill-accent text-accent" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Add to Cart */}
                <button
                  type="button"
                  aria-label={`Add ${product.title} to cart`}
                  className="
                      group/cart
                      flex h-8 items-center gap-1.5
                      rounded-full
                      bg-primary
                      px-3
                      text-[10px]
                      font-medium
                      text-primary-foreground
                      transition-all
                      duration-300
                      hover:-translate-y-0.5
                      hover:bg-primary-dark
                    "
                >
                  <ShoppingBag className="size-3.5" />

                  <span className="hidden sm:inline">Add</span>
                </button>
              </div>
            </article>
          ))}
        </div>

        {/* Mobile View All */}
        <Link
          href="/shop"
          className="
            mt-10
            flex items-center justify-center gap-2
            text-xs font-medium uppercase tracking-wider
            md:hidden
          "
        >
          <span>View All Products</span>
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </section>
  );
};

export default Products;

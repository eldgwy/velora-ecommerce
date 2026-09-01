"use client";

import Image from "next/image";
import Link from "next/link";
import { categories } from "@/constants";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/all";

const FeaturedCategories = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.registerPlugin(ScrollTrigger);

      const section = sectionRef.current;
      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const heading = section.querySelector<HTMLElement>(".category-heading");
      const cards = gsap.utils.toArray<HTMLElement>(".category-card");
      const images = gsap.utils.toArray<HTMLElement>(".category-image");

      // Master timeline controlled entirely by scroll position
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
       * ENTER
       * =========================
       */

      // Heading enters from below
      if (heading) {
        tl.fromTo(
          heading,
          {
            y: 60,
            opacity: 0,
          },
          {
            y: 0,
            opacity: 1,
            duration: 0.3,
            ease: "power2.out",
          },
          0,
        );
      }

      // Cards enter from below
      tl.fromTo(
        cards,
        {
          y: 140,
          opacity: 0,
          scale: 0.9,
          rotate: (index) => (index % 2 === 0 ? -1.5 : 1.5),
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          rotate: 0,
          duration: 0.35,
          stagger: 0.08,
          ease: "power2.out",
        },
        0.05,
      );

      /*
       * =========================
       * IMAGE MOVEMENT
       * =========================
       */

      tl.fromTo(
        images,
        {
          scale: 1.08,
          yPercent: (index) => (index % 2 === 0 ? 5 : -5),
        },
        {
          scale: 1,
          yPercent: 0,
          duration: 0.4,
          stagger: 0.05,
          ease: "none",
        },
        0,
      );

      /*
       * =========================
       * HOLD
       * =========================
       *
       * Nothing happens here.
       *
       * The cards stay visible while
       * the user continues scrolling.
       */

      /*
       * =========================
       * EXIT
       * =========================
       */

      // Heading leaves upward
      if (heading) {
        tl.to(
          heading,
          {
            y: -60,
            opacity: 0,
            duration: 0.3,
            ease: "power2.in",
          },
          0.7,
        );
      }

      // Cards leave upward
      tl.to(
        cards,
        {
          y: -140,
          opacity: 0,
          scale: 0.9,
          rotate: (index) => (index % 2 === 0 ? 1.5 : -1.5),
          duration: 0.3,
          stagger: 0.08,
          ease: "power2.in",
        },
        0.7,
      );

      // Images subtly move while section exits
      tl.to(
        images,
        {
          scale: 1.08,
          yPercent: (index) => (index % 2 === 0 ? -5 : 5),
          duration: 0.3,
          stagger: 0.05,
          ease: "none",
        },
        0.7,
      );
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} className="px-4 py-20 md:px-8 lg:py-28">
      <div className="mx-auto max-w-360">
        {/* Section Header */}
        <div ref={titleRef} className="mb-10 flex items-end justify-between">
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-primary">
              Explore
            </p>

            <h2 className="font-display text-4xl tracking-tight md:text-5xl">
              Shop by Category
            </h2>
          </div>

          <Link
            href="/categories"
            className="hidden text-sm font-medium transition-colors hover:text-primary md:block"
          >
            View All →
          </Link>
        </div>

        {/* Categories */}
        <div
          ref={cardsRef}
          className="grid grid-cols-2 gap-4 md:grid-cols-4 category-card"
        >
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="group relative overflow-hidden rounded-2xl"
            >
              <div className="relative aspect-4/5 overflow-hidden">
                <Image
                  src={category.image}
                  alt={category.name}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />

                {/* Overlay */}
                <div className="absolute inset-0 bg-black/10 transition-colors duration-500 group-hover:bg-black/20" />

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
        <Link
          href="/categories"
          className="mt-6 block text-sm font-medium md:hidden"
        >
          View All Categories →
        </Link>
      </div>
    </section>
  );
};

export default FeaturedCategories;

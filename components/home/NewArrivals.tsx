"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Heart } from "lucide-react";
import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { Products as ProductsList, type Product } from "@/constants";

gsap.registerPlugin(ScrollTrigger);

const NewArrivals = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  /*
   * Temporary:
   * Replace this later with real "new arrivals"
   * data from your backend.
   */
  const newArrivals = ProductsList.slice(0, 8);

  /*
   * ========================================
   * GSAP
   * ========================================
   */

  useGSAP(
    () => {
      const section = sectionRef.current;
      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const heading = section.querySelector<HTMLElement>(".arrivals-heading");

      const cards = gsap.utils.toArray<HTMLElement>(".arrival-card");

      const images = gsap.utils.toArray<HTMLElement>(".arrival-image");

      /*
       * ----------------------------------------
       * MASTER SCROLL TIMELINE
       * ----------------------------------------
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
       * ----------------------------------------
       * HEADING
       * ----------------------------------------
       */

      if (heading) {
        tl.fromTo(
          heading,
          {
            x: 60,
            opacity: 0,
          },
          {
            x: 0,
            opacity: 1,
            duration: 0.3,
            ease: "power3.out",
          },
          0,
        );
      }

      /*
       * ----------------------------------------
       * CARDS ENTER
       * ----------------------------------------
       */

      tl.fromTo(
        cards,
        {
          x: 80,
          opacity: 0,
          scale: 0.94,
        },
        {
          x: 0,
          opacity: 1,
          scale: 1,
          duration: 0.4,
          stagger: 0.06,
          ease: "power3.out",
        },
        0.05,
      );

      /*
       * ----------------------------------------
       * IMAGE REVEAL
       * ----------------------------------------
       */

      tl.fromTo(
        images,
        {
          scale: 1.08,
          xPercent: 3,
        },
        {
          scale: 1,
          xPercent: 0,
          duration: 0.5,
          stagger: 0.04,
          ease: "none",
        },
        0,
      );

      /*
       * ----------------------------------------
       * EXIT
       * ----------------------------------------
       */

      tl.to(
        cards,
        {
          x: -80,
          opacity: 0,
          scale: 0.96,
          duration: 0.3,
          stagger: 0.04,
          ease: "power2.in",
        },
        0.72,
      );

      /*
       * ----------------------------------------
       * HEADING EXIT
       * ----------------------------------------
       */

      if (heading) {
        tl.to(
          heading,
          {
            x: -50,
            opacity: 0,
            duration: 0.25,
            ease: "power2.in",
          },
          0.75,
        );
      }

      /*
       * ----------------------------------------
       * IMAGE EXIT
       * ----------------------------------------
       */

      tl.to(
        images,
        {
          scale: 1.05,
          xPercent: -2,
          duration: 0.3,
          stagger: 0.04,
          ease: "none",
        },
        0.72,
      );
    },
    {
      scope: sectionRef,
    },
  );

  /*
   * ========================================
   * RAIL CONTROLS
   * ========================================
   */

  const scrollRail = (direction: "left" | "right") => {
    const rail = railRef.current;

    if (!rail) return;

    const amount = rail.clientWidth * 0.75;

    rail.scrollBy({
      left: direction === "right" ? amount : -amount,
      behavior: "smooth",
    });
  };

  return (
    <section
      ref={sectionRef}
      className="overflow-hidden px-4 py-16 md:px-8 lg:py-20"
    >
      <div className="mx-auto max-w-360">
        {/* ========================================
            HEADER
        ======================================== */}

        <div className="arrivals-heading mb-7 flex items-end justify-between">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
              Just In
            </p>

            <h2 className="font-display text-3xl tracking-tight md:text-4xl">
              New Arrivals
            </h2>
          </div>

          <div className="flex items-center gap-5">
            {/* Desktop arrows */}

            <div className="hidden items-center gap-2 md:flex">
              <button
                type="button"
                aria-label="Previous products"
                onClick={() => scrollRail("left")}
                className="
                  flex size-9 items-center justify-center
                  rounded-full
                  border border-border
                  text-foreground
                  transition-all duration-300
                  hover:border-primary
                  hover:bg-primary
                  hover:text-primary-foreground
                "
              >
                <ArrowLeft className="size-3.5" />
              </button>

              <button
                type="button"
                aria-label="Next products"
                onClick={() => scrollRail("right")}
                className="
                  flex size-9 items-center justify-center
                  rounded-full
                  border border-border
                  text-foreground
                  transition-all duration-300
                  hover:border-primary
                  hover:bg-primary
                  hover:text-primary-foreground
                "
              >
                <ArrowRight className="size-3.5" />
              </button>
            </div>

            <Link
              href="/shop?sort=newest"
              className="
                hidden
                items-center
                gap-2
                text-[10px]
                font-medium
                uppercase
                tracking-[0.2em]
                text-muted-foreground
                transition-colors
                hover:text-primary
                md:flex
              "
            >
              View All
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        {/* ========================================
            PRODUCT RAIL
        ======================================== */}

        <div
          ref={railRef}
          className="
            -mx-4
            flex
            gap-3
            overflow-x-auto
            px-4
            pb-2
            scrollbar-none
            snap-x
            snap-mandatory

            md:-mx-8
            md:gap-4
            md:px-8
          "
        >
          {newArrivals.map((product: Product) => (
            <article
              key={product.id}
              className="
                arrival-card
                group
                w-37.5
                shrink-0
                snap-start

                sm:w-45

                md:w-50

                lg:w-55
              "
            >
              {/* ========================================
                  IMAGE
              ======================================== */}

              <div
                className="
                  relative
                  overflow-hidden
                  bg-surface-muted
                  rounded-lg
                "
              >
                <Link href={`/products/${product.id}`}>
                  <div className="relative aspect-4/5 overflow-hidden">
                    <Image
                      src={product.image || "/images/product-placeholder.jpg"}
                      alt={product.title}
                      fill
                      sizes="
                        (max-width: 640px) 150px,
                        (max-width: 768px) 180px,
                        (max-width: 1024px) 200px,
                        220px
                      "
                      className="
                        arrival-image
                        object-cover
                        transition-transform
                        duration-700
                        ease-out
                        group-hover:scale-[1.04]
                      "
                    />

                    {/* Hover overlay */}

                    <div
                      className="
                        absolute
                        inset-0
                        bg-black/0
                        transition-colors
                        duration-500
                        group-hover:bg-black/5
                      "
                    />
                  </div>
                </Link>

                {/* ========================================
                    NEW BADGE
                ======================================== */}

                <span
                  className="
                    absolute
                    left-2.5
                    top-2.5
                    border
                    border-white/60
                    bg-white/80
                    rounded-sm
                    px-2
                    py-1
                    text-[8px]
                    font-medium
                    uppercase
                    tracking-[0.15em]
                    backdrop-blur-sm
                  "
                >
                  New
                </span>

                {/* ========================================
                    WISHLIST
                ======================================== */}

                <button
                  type="button"
                  aria-label={`Add ${product.title} to wishlist`}
                  className="
                    absolute
                    right-2.5
                    top-2.5
                    flex
                    size-7
                    items-center
                    justify-center
                    bg-white/80
                    backdrop-blur-sm
                    rounded-sm
                    transition-all
                    duration-300
                    hover:bg-white
                    hover:text-primary
                  "
                >
                  <Heart className="size-3.5" />
                </button>
              </div>

              {/* ========================================
                  INFO
              ======================================== */}

              <div className="pt-2.5">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/products/${product.id}`} className="min-w-0">
                    <h3
                      className="
                        truncate
                        text-[10px]
                        font-medium
                        uppercase
                        tracking-[0.04em]
                        transition-colors
                        hover:text-primary
                        sm:text-[11px]
                      "
                    >
                      {product.title}
                    </h3>
                  </Link>

                  <span
                    className="
                      shrink-0
                      text-[10px]
                      font-medium
                      sm:text-[11px]
                    "
                  >
                    ${product.price}
                  </span>
                </div>

                {/* Color dots */}

                <div className="mt-2 flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full border border-border bg-[#d8cbb8]" />

                  <span className="size-2.5 rounded-full border border-border bg-[#173f35]" />

                  <span className="size-2.5 rounded-full border border-border bg-[#c9c3b7]" />
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* ========================================
            MOBILE VIEW ALL
        ======================================== */}

        <div className="mt-7 flex items-center justify-between md:hidden">
          <Link
            href="/shop?sort=newest"
            className="
              flex
              items-center
              gap-2
              text-[10px]
              font-medium
              uppercase
              tracking-[0.18em]
            "
          >
            View All
            <ArrowRight className="size-3.5" />
          </Link>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous products"
              onClick={() => scrollRail("left")}
              className="
                flex
                size-8
                items-center
                justify-center
                rounded-full
                border
                border-border
              "
            >
              <ArrowLeft className="size-3" />
            </button>

            <button
              type="button"
              aria-label="Next products"
              onClick={() => scrollRail("right")}
              className="
                flex
                size-8
                items-center
                justify-center
                rounded-full
                border
                border-border
              "
            >
              <ArrowRight className="size-3" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default NewArrivals;

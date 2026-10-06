"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import PromotionImage from "@/images/promotion.jpg";

gsap.registerPlugin(ScrollTrigger);

const Promotion = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;

      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const content = gsap.utils.toArray<HTMLElement>(".promo-content");

      const imageWrapper = section.querySelector<HTMLElement>(
        ".promo-image-wrapper",
      );

      const image = section.querySelector<HTMLElement>(".promo-image");

      const badge = section.querySelector<HTMLElement>(".promo-badge");

      const line = section.querySelector<HTMLElement>(".promo-line");

      if (!imageWrapper || !image || !badge || !line) {
        return;
      }

      // Initial states
      gsap.set(content, {
        y: 35,
        opacity: 0,
      });

      gsap.set(imageWrapper, {
        clipPath: "inset(0 100% 0 0)",
      });

      gsap.set(image, {
        scale: 1.08,
      });

      gsap.set(badge, {
        scale: 0.8,
        opacity: 0,
      });

      gsap.set(line, {
        scaleX: 0,
        transformOrigin: "left center",
      });

      // Entrance animation
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top 78%",
          toggleActions: "play none none reverse",
        },
      });

      timeline
        .to(content, {
          y: 0,
          opacity: 1,
          duration: 0.7,
          stagger: 0.1,
          ease: "power3.out",
        })
        .to(
          imageWrapper,
          {
            clipPath: "inset(0 0% 0 0)",
            duration: 1.1,
            ease: "power4.inOut",
          },
          0,
        )
        .to(
          image,
          {
            scale: 1,
            duration: 1.3,
            ease: "power3.out",
          },
          0,
        )
        .to(
          badge,
          {
            scale: 1,
            opacity: 1,
            duration: 0.55,
            ease: "back.out(1.5)",
          },
          0.4,
        )
        .to(
          line,
          {
            scaleX: 1,
            duration: 0.7,
            ease: "power3.out",
          },
          0.45,
        );

      // Subtle parallax
      gsap.to(image, {
        yPercent: -3,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      });
    },
    {
      scope: sectionRef,
    },
  );

  return (
    <section
      ref={sectionRef}
      className="px-4 py-14 md:px-6 md:py-20 lg:px-10 lg:py-24"
    >
      <div className="mx-auto max-w-360">
        <div className="relative overflow-hidden rounded-2xl bg-primary lg:h-97">
          <div className="grid lg:h-full lg:grid-cols-[0.9fr_1.1fr]">
            {/* =========================================
                CONTENT
            ========================================== */}
            <div className="relative flex items-center px-7 py-12 sm:px-10 md:px-14 lg:px-12 xl:px-16">
              {/* Decorative letter */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-20 -left-8 select-none font-display text-[15rem] font-light leading-none text-white/[0.035]"
              >
                V
              </div>

              <div className="relative z-10 max-w-lg">
                {/* Eyebrow */}
                <p className="promo-content mb-4 text-[9px] font-semibold uppercase tracking-[0.3em] text-accent">
                  Exclusive Offer
                </p>

                {/* Heading */}
                <h2 className="promo-content font-display text-4xl leading-[1.02] tracking-tight text-white sm:text-5xl md:text-6xl">
                  A little more
                  <br />
                  <span className="text-accent">luxury.</span>
                </h2>

                {/* Description */}
                <p className="promo-content mt-5 max-w-md text-xs leading-6 text-white/60 sm:text-sm sm:leading-7">
                  Enjoy 20% off selected pieces from our latest collection.
                  Discover timeless essentials designed to elevate the everyday.
                </p>

                {/* CTA */}
                <div className="promo-content mt-6 flex flex-wrap items-center gap-4">
                  <Link
                    href="/collections"
                    className="group inline-flex items-center gap-3 rounded-full bg-accent px-5 py-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-primary transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
                  >
                    Shop The Edit
                    <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>

                  <span className="text-[9px] uppercase tracking-[0.16em] text-white/30">
                    Limited time
                  </span>
                </div>

                {/* Decorative line */}
                <div className="promo-line mt-6 h-px w-32 bg-white/20" />
              </div>
            </div>

            {/* =========================================
                LANDSCAPE IMAGE
            ========================================== */}
            <div className="relative h-65 overflow-hidden sm:h-75 lg:h-full">
              <div className="promo-image-wrapper absolute inset-0 overflow-hidden">
                <Link
                  href="/collections"
                  aria-label="Shop VELORA collection"
                  className="group block h-full w-full"
                >
                  <Image
                    src={PromotionImage}
                    alt="VELORA collection"
                    fill
                    sizes="(max-width: 1024px) 100vw, 55vw"
                    className="promo-image object-cover object-center transition-transform duration-1000 ease-out group-hover:scale-[1.03]"
                  />

                  {/* Image overlay */}
                  <div className="absolute inset-0 bg-black/5 transition-colors duration-700 group-hover:bg-black/15" />

                  {/* Hover arrow */}
                  <div className="absolute bottom-5 right-5 flex size-10 items-center justify-center rounded-full border border-white/40 bg-white/85 text-foreground opacity-0 shadow-md backdrop-blur-md transition-all duration-500 group-hover:opacity-100 md:bottom-6 md:right-6">
                    <ArrowUpRight className="size-4" />
                  </div>
                </Link>
              </div>

              {/* Discount badge */}
              <div className="promo-badge absolute left-5 top-5 z-10 md:left-6 md:top-6">
                <div className="flex size-20 flex-col items-center justify-center rounded-full bg-accent text-center text-primary shadow-lg">
                  <span className="text-[7px] font-semibold uppercase tracking-[0.15em]">
                    Up to
                  </span>

                  <span className="font-display text-2xl leading-none">
                    20%
                  </span>

                  <span className="mt-0.5 text-[7px] font-medium uppercase tracking-wider">
                    Off
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Promotion;

"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import StoryImage from "@/images/story.jpg";

gsap.registerPlugin(ScrollTrigger);

const OurStory = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;

      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const eyebrow = section.querySelector<HTMLElement>(".story-eyebrow");
      const heading = section.querySelector<HTMLElement>(".story-heading");
      const description =
        section.querySelector<HTMLElement>(".story-description");
      const cta = section.querySelector<HTMLElement>(".story-cta");
      const imageReveal = section.querySelector<HTMLElement>(
        ".story-image-reveal",
      );
      const image = section.querySelector<HTMLElement>(".story-image");
      const imageFrame =
        section.querySelector<HTMLElement>(".story-image-frame");

      if (
        !eyebrow ||
        !heading ||
        !description ||
        !cta ||
        !imageReveal ||
        !image ||
        !imageFrame
      ) {
        return;
      }

      const contentItems = [eyebrow, heading, description, cta];

      gsap.set(contentItems, {
        y: 45,
        opacity: 0,
      });

      gsap.set(imageReveal, {
        clipPath: "inset(0 100% 0 0)",
      });

      gsap.set(image, {
        scale: 1.12,
        xPercent: 3,
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top 75%",
          end: "top 25%",
          toggleActions: "play none none reverse",
        },
      });

      tl.to(
        eyebrow,
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          ease: "power3.out",
        },
        0,
      )
        .to(
          heading,
          {
            y: 0,
            opacity: 1,
            duration: 0.9,
            ease: "power3.out",
          },
          0.12,
        )
        .to(
          description,
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power3.out",
          },
          0.28,
        )
        .to(
          cta,
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power3.out",
          },
          0.38,
        )
        .to(
          imageReveal,
          {
            clipPath: "inset(0 0% 0 0)",
            duration: 1.2,
            ease: "power4.inOut",
          },
          0,
        )
        .to(
          image,
          {
            scale: 1,
            xPercent: 0,
            duration: 1.4,
            ease: "power3.out",
          },
          0,
        );

      // Subtle image parallax while scrolling through the section
      gsap.to(image, {
        yPercent: -6,
        ease: "none",
        scrollTrigger: {
          trigger: imageFrame,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      });

      // Slight movement of the decorative number
      const number = section.querySelector<HTMLElement>(".story-number");

      if (number) {
        gsap.fromTo(
          number,
          {
            y: 40,
            opacity: 0,
          },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            ease: "power3.out",
            scrollTrigger: {
              trigger: section,
              start: "top 70%",
              toggleActions: "play none none reverse",
            },
          },
        );
      }
    },
    {
      scope: sectionRef,
    },
  );

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden px-4 py-20 md:px-8 md:py-28 lg:px-12 lg:py-36"
    >
      <div className="mx-auto max-w-360">
        <div className="grid items-center gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 xl:gap-28">
          {/* Content */}
          <div className="relative z-10 max-w-xl">
            <div className="story-number pointer-events-none absolute -left-4 -top-16 select-none text-[7rem] font-light leading-none text-primary/5 md:-left-8 md:-top-24 md:text-[11rem]">
              01
            </div>

            <div className="relative">
              <p className="story-eyebrow mb-5 text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
                Our Story
              </p>

              <h2 className="story-heading font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl lg:text-6xl xl:text-7xl">
                Designed with
                <br />
                <span className="text-primary">intention.</span>
              </h2>

              <p className="story-description mt-7 max-w-md text-sm leading-7 text-muted-foreground md:mt-9 md:text-base md:leading-8">
                VELORA is built around the belief that true luxury lives in the
                details. Every piece is carefully selected to bring timeless
                design, refined materials, and effortless elegance into everyday
                life.
              </p>

              <Link
                href="/about"
                className="story-cta group mt-8 inline-flex items-center gap-3 border-b border-foreground/20 pb-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors duration-300 hover:border-primary hover:text-primary md:mt-10"
              >
                <span>Discover Our Story</span>

                <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </div>

          {/* Image */}
          <div className="relative">
            <div className="story-image-frame relative aspect-4/5 overflow-hidden  rounded-2xl bg-surface-muted md:aspect-9/8">
              <div className="story-image-reveal overflow-hidden absolute inset-0">
                <Link
                  href="/about"
                  className="group block h-full w-full"
                  aria-label="Discover the VELORA story"
                >
                  <Image
                    src={StoryImage}
                    alt="VELORA editorial story"
                    fill
                    sizes="(max-width: 1024px) 100vw, 60vw"
                    className="story-image object-contain transition-transform duration-1000 ease-out group-hover:scale-[1.03]"
                    priority={false}
                  />

                  <div className="absolute bottom-5 right-5 flex size-11 items-center justify-center rounded-full border border-white/40 bg-white/85 text-foreground opacity-0 shadow-sm backdrop-blur-md transition-all duration-500 group-hover:opacity-100 md:bottom-7 md:right-7">
                    <ArrowUpRight className="size-4" />
                  </div>
                </Link>
              </div>

              {/* Editorial label */}
              <div className="absolute left-5 top-5 z-10 md:left-7 md:top-7">
                <span className="rounded-full border border-white/40 bg-white/80 px-3 py-1.5 text-[9px] font-medium uppercase tracking-[0.18em] text-foreground backdrop-blur-md">
                  The VELORA Edit
                </span>
              </div>
            </div>

            {/* Small decorative line */}
            <div className="absolute -bottom-5 right-0 hidden h-px w-24 bg-border md:block" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default OurStory;

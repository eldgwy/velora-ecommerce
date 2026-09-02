"use client";

import { ArrowRight, Mail } from "lucide-react";
import { FormEvent, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const Newsletter = () => {
  const sectionRef = useRef<HTMLElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Connect to your newsletter API later.
  };

  useGSAP(
    () => {
      const section = sectionRef.current;

      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const eyebrow = section.querySelector<HTMLElement>(".newsletter-eyebrow");

      const heading = section.querySelector<HTMLElement>(".newsletter-heading");

      const description = section.querySelector<HTMLElement>(
        ".newsletter-description",
      );

      const form = section.querySelector<HTMLElement>(".newsletter-form");

      const decoration = section.querySelector<HTMLElement>(
        ".newsletter-decoration",
      );

      if (!eyebrow || !heading || !description || !form || !decoration) {
        return;
      }

      gsap.set([eyebrow, heading, description, form], {
        y: 30,
        opacity: 0,
      });

      gsap.set(decoration, {
        scaleX: 0,
        transformOrigin: "center center",
      });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top 80%",
          toggleActions: "play none none reverse",
        },
      });

      timeline
        .to(eyebrow, {
          y: 0,
          opacity: 1,
          duration: 0.5,
          ease: "power3.out",
        })
        .to(
          heading,
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power3.out",
          },
          0.08,
        )
        .to(
          description,
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            ease: "power3.out",
          },
          0.18,
        )
        .to(
          form,
          {
            y: 0,
            opacity: 1,
            duration: 0.65,
            ease: "power3.out",
          },
          0.28,
        )
        .to(
          decoration,
          {
            scaleX: 1,
            duration: 0.8,
            ease: "power3.out",
          },
          0.35,
        );
    },
    {
      scope: sectionRef,
    },
  );

  return (
    <section
      ref={sectionRef}
      className="px-4 py-20 md:px-6 md:py-28 lg:px-10 lg:py-32"
    >
      <div className="mx-auto max-w-360">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-muted px-6 py-14 sm:px-10 md:px-16 md:py-20 lg:px-20 lg:py-24">
          {/* Decorative background */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 size-100 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/4"
          />

          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 size-70 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/4"
          />

          <div className="relative z-10 mx-auto max-w-2xl text-center">
            {/* Eyebrow */}
            <p className="newsletter-eyebrow mb-4 text-[9px] font-semibold uppercase tracking-[0.32em] text-primary">
              Stay In The Know
            </p>

            {/* Heading */}
            <h2 className="newsletter-heading font-display text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
              Join the
              <br />
              <span className="text-primary">VELORA edit.</span>
            </h2>

            {/* Description */}
            <p className="newsletter-description mx-auto mt-5 max-w-md text-xs leading-6 text-muted-foreground md:mt-6 md:text-sm md:leading-7">
              Be the first to discover new collections, exclusive offers, and
              stories from VELORA.
            </p>

            {/* Form */}
            <form
              onSubmit={handleSubmit}
              className="newsletter-form mx-auto mt-8 flex w-full max-w-lg flex-col gap-2 sm:flex-row sm:rounded-full sm:border sm:border-border sm:bg-white sm:p-1.5 md:mt-10"
            >
              <div className="relative flex min-w-0 flex-1 items-center rounded-full border border-border bg-white px-4 sm:border-0">
                <Mail className="mr-2.5 size-3.5 shrink-0 text-muted-foreground" />

                <input
                  type="email"
                  name="email"
                  placeholder="Your email address"
                  required
                  autoComplete="email"
                  className="h-11 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                />
              </div>

              <button
                type="submit"
                className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-[9px] font-semibold uppercase tracking-[0.16em] text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-dark"
              >
                Subscribe
                <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
              </button>
            </form>

            <p className="mt-4 text-[9px] text-muted-foreground/60">
              By subscribing, you agree to receive VELORA updates.
            </p>

            {/* Decorative line */}
            <div className="newsletter-decoration mx-auto mt-8 h-px w-24 bg-primary/20" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Newsletter;

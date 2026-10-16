"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import Hero from "@/shared/components/home/Hero";
import { Button } from "@/shared/components/ui/button";

interface HeroBanner {
  id: string;
  title: string;
  subtitle: string | null;
  image: string;
  mobileImage: string | null;
  link: string | null;
}

/**
 * Storefront hero: eligible banners as an accessible manual carousel,
 * falling back to the static brand hero when none exist (or the fetch
 * fails — merchandising must never break the homepage).
 *
 * - One slide visible; prev/next buttons + dot indicators (all labelled).
 * - Keyboard: left/right arrows move when the region is focused.
 * - No autoplay (reduced-motion safe); transitions honor motion-reduce.
 * - Mobile image below the md breakpoint, desktop at md and up.
 * - Broken images hide the slide artwork, never the text content.
 */
export function HeroBanners() {
  const [banners, setBanners] = useState<HeroBanner[] | null>(null);
  const [index, setIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/banners", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("banner fetch failed");
        const body = (await res.json()) as { items?: HeroBanner[] };
        if (!cancelled) {
          const items = Array.isArray(body.items) ? body.items : [];
          setBanners(items);
          setIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) setBanners([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const go = useCallback(
    (delta: number) => {
      const count = banners?.length ?? 0;
      if (count === 0) return;
      setIndex((i) => (i + delta + count) % count);
    },
    [banners],
  );

  if (banners === null) return null;
  if (banners.length === 0) return <Hero />;

  const current = banners[Math.min(index, banners.length - 1)]!;
  const markFailed = (id: string) =>
    setFailedImages((prev) => new Set(prev).add(id));
  const imageFailed = failedImages.has(current.id);
  const mobileSrc = current.mobileImage ?? current.image;

  const cta =
    current.link && (current.link.startsWith("/") || current.link.startsWith("https://")) ? (
      current.link.startsWith("/") ? (
        <Link
          href={current.link}
          className="inline-flex items-center gap-2 rounded-full bg-white/90 px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:bg-white"
        >
          Shop now <ArrowRight className="size-4" />
        </Link>
      ) : (
        <a
          href={current.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-white/90 px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:bg-white"
        >
          Shop now <ArrowRight className="size-4" />
        </a>
      )
    ) : null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured promotions"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
      className="relative h-[70vh] min-h-[480px] w-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {!imageFailed ? (
        <>
          <Image
            key={`d-${current.id}`}
            src={current.image}
            alt=""
            fill
            priority
            sizes="100vw"
            className="hidden object-cover md:block"
            onError={() => markFailed(current.id)}
          />
          <Image
            key={`m-${current.id}`}
            src={mobileSrc}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover md:hidden"
            onError={() => markFailed(current.id)}
          />
        </>
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" aria-hidden="true" />

      <div className="absolute inset-x-0 bottom-0 pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/80">
            Featured
          </p>
          <h2 className="mt-2 max-w-xl text-4xl font-bold tracking-tight text-white md:text-6xl">
            {current.title}
          </h2>
          {current.subtitle ? (
            <p className="mt-3 max-w-lg text-white/85">{current.subtitle}</p>
          ) : null}
          {cta ? <div className="mt-6">{cta}</div> : null}
        </div>
      </div>

      {banners.length > 1 ? (
        <>
          <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to slide ${i + 1}: ${b.title}`}
                aria-current={i === index}
                className={`h-2 rounded-full transition-all motion-reduce:transition-none ${
                  i === index ? "w-8 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
                }`}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go(-1)}
            aria-label="Previous slide"
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/80 text-foreground backdrop-blur hover:bg-white"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go(1)}
            aria-label="Next slide"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/80 text-foreground backdrop-blur hover:bg-white"
          >
            <ArrowRight className="size-4" />
          </Button>
        </>
      ) : null}
      <p className="sr-only" aria-live="polite">
        Slide {index + 1} of {banners.length}: {current.title}
      </p>
    </section>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Heart } from "lucide-react";
import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { Products as ProductsList, type Product } from "@/constants";

gsap.registerPlugin(ScrollTrigger);

const BestSellers = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const products = ProductsList.slice(0, 5);

  const activeProduct = products[activeIndex];

  const nextProduct = () => {
    setActiveIndex((current) =>
      current === products.length - 1 ? 0 : current + 1,
    );
  };

  const previousProduct = () => {
    setActiveIndex((current) =>
      current === 0 ? products.length - 1 : current - 1,
    );
  };

  useGSAP(
    () => {
      const section = sectionRef.current;

      if (!section) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const eyebrow = section.querySelector<HTMLElement>(".sellers-eyebrow");

      const heading = section.querySelector<HTMLElement>(".sellers-heading");

      const description = section.querySelector<HTMLElement>(
        ".sellers-description",
      );

      const mainImage = section.querySelector<HTMLElement>(
        ".sellers-main-image",
      );

      const sideCards = gsap.utils.toArray<HTMLElement>(".seller-side-card");

      const controls = section.querySelector<HTMLElement>(".sellers-controls");

      if (!eyebrow || !heading || !description || !mainImage || !controls) {
        return;
      }

      gsap.set([eyebrow, heading, description, controls], {
        y: 35,
        opacity: 0,
      });

      gsap.set(mainImage, {
        scale: 1.08,
        opacity: 0,
      });

      gsap.set(sideCards, {
        y: 45,
        opacity: 0,
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top 75%",
          toggleActions: "play none none reverse",
        },
      });

      tl.to(
        eyebrow,
        {
          y: 0,
          opacity: 1,
          duration: 0.5,
          ease: "power3.out",
        },
        0,
      )
        .to(
          heading,
          {
            y: 0,
            opacity: 1,
            duration: 0.75,
            ease: "power3.out",
          },
          0.08,
        )
        .to(
          description,
          {
            y: 0,
            opacity: 1,
            duration: 0.65,
            ease: "power3.out",
          },
          0.2,
        )
        .to(
          mainImage,
          {
            scale: 1,
            opacity: 1,
            duration: 1,
            ease: "power3.out",
          },
          0,
        )
        .to(
          sideCards,
          {
            y: 0,
            opacity: 1,
            duration: 0.65,
            stagger: 0.08,
            ease: "power3.out",
          },
          0.25,
        )
        .to(
          controls,
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            ease: "power3.out",
          },
          0.4,
        );
    },
    {
      scope: sectionRef,
    },
  );

  useGSAP(
    () => {
      const image = sectionRef.current?.querySelector<HTMLElement>(
        ".sellers-main-image",
      );

      if (!image) return;

      gsap.fromTo(
        image,
        {
          scale: 1.04,
          opacity: 0.5,
        },
        {
          scale: 1,
          opacity: 1,
          duration: 0.65,
          ease: "power3.out",
        },
      );
    },
    {
      dependencies: [activeIndex],
      scope: sectionRef,
    },
  );

  if (!activeProduct) return null;

  return (
    <section
      ref={sectionRef}
      className="px-4 py-16 md:px-6 md:py-24 lg:px-10 lg:py-28"
    >
      <div className="mx-auto max-w-360">
        {/* Header */}
        <div className="mb-10 flex items-end justify-between md:mb-12">
          <div>
            <p className="sellers-eyebrow mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
              Most Wanted
            </p>

            <h2 className="sellers-heading font-display text-3xl tracking-tight md:text-4xl lg:text-5xl">
              Best Sellers
            </h2>

            <p className="sellers-description mt-3 max-w-md text-xs leading-6 text-muted-foreground md:text-sm">
              Pieces our customers keep coming back to.
            </p>
          </div>

          <Link
            href="/shop"
            className="group hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] md:flex"
          >
            View All
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>

        {/* Main Showcase */}
        <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          {/* Main Product */}
          <div className="relative overflow-hidden rounded-2xl bg-surface-muted">
            <Link
              href={`/products/${activeProduct.id}`}
              className="group block"
            >
              <div className="relative aspect-4/3 overflow-hidden md:aspect-16/10">
                <Image
                  key={activeProduct.id}
                  src={activeProduct.image || "/images/product-placeholder.jpg"}
                  alt={activeProduct.title}
                  fill
                  sizes="(max-width: 1024px) 100vw, 65vw"
                  className="sellers-main-image object-cover transition-transform duration-1000 ease-out group-hover:scale-[1.03]"
                  priority={false}
                />

                <div className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-black/5" />

                {/* Category */}
                <span className="absolute left-4 top-4 rounded-full border border-white/50 bg-white/80 px-3 py-1.5 text-[9px] font-medium uppercase tracking-[0.15em] text-foreground backdrop-blur-md md:left-6 md:top-6">
                  {activeProduct.category}
                </span>

                {/* Wishlist */}
                <button
                  type="button"
                  aria-label={`Add ${activeProduct.title} to wishlist`}
                  onClick={(event) => event.preventDefault()}
                  className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full border border-white/50 bg-white/80 text-foreground backdrop-blur-md transition-all duration-300 hover:scale-105 hover:bg-white hover:text-red-500 md:right-6 md:top-6"
                >
                  <Heart className="size-4" />
                </button>

                {/* Product Info */}
                <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/70 via-black/25 to-transparent p-5 pt-20 text-white md:p-7 md:pt-28">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-white/60">
                        Featured Piece
                      </p>

                      <h3 className="font-display text-2xl md:text-3xl">
                        {activeProduct.title}
                      </h3>
                    </div>

                    <span className="shrink-0 text-sm font-medium">
                      ${activeProduct.price}
                    </span>
                  </div>
                </div>

                {/* Open Product */}
                <div className="absolute bottom-5 right-5 hidden size-10 items-center justify-center rounded-full bg-white text-foreground opacity-0 shadow-md transition-all duration-500 group-hover:opacity-100 md:flex">
                  <ArrowUpRight className="size-4" />
                </div>
              </div>
            </Link>
          </div>

          {/* Side Products */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            {products
              .filter((_, index) => index !== activeIndex)
              .slice(0, 3)
              .map((product: Product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() =>
                    setActiveIndex(
                      products.findIndex((p) => p.id === product.id),
                    )
                  }
                  className="seller-side-card group relative min-w-0 overflow-hidden rounded-xl bg-surface-muted text-left"
                >
                  <div className="relative aspect-4/3 overflow-hidden lg:aspect-16/7">
                    <Image
                      src={product.image || "/images/product-placeholder.jpg"}
                      alt={product.title}
                      fill
                      sizes="(max-width: 1024px) 50vw, 30vw"
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                    />

                    <div className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-black/5" />

                    <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent p-4 pt-12 text-white">
                      <div className="flex items-end justify-between gap-2">
                        <h3 className="truncate text-xs font-medium md:text-sm">
                          {product.title}
                        </h3>

                        <span className="shrink-0 text-[10px]">
                          ${product.price}
                        </span>
                      </div>
                    </div>
                  </div>

                  <span className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-white/85 text-foreground opacity-0 backdrop-blur-md transition-all duration-300 group-hover:opacity-100">
                    <ArrowUpRight className="size-3.5" />
                  </span>
                </button>
              ))}
          </div>
        </div>

        {/* Controls */}
        <div className="sellers-controls mt-6 flex items-center justify-between border-t border-border-subtle pt-5">
          <div className="flex items-center gap-2">
            {products.map((product, index) => (
              <button
                key={product.id}
                type="button"
                aria-label={`Show product ${index + 1}`}
                onClick={() => setActiveIndex(index)}
                className={`h-px transition-all duration-300 ${
                  index === activeIndex ? "w-10 bg-primary" : "w-5 bg-border"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={previousProduct}
              aria-label="Previous product"
              className="flex size-9 items-center justify-center rounded-full border border-border transition-all duration-300 hover:border-primary hover:text-primary"
            >
              <ArrowLeft className="size-3.5" />
            </button>

            <button
              type="button"
              onClick={nextProduct}
              aria-label="Next product"
              className="flex size-9 items-center justify-center rounded-full border border-border transition-all duration-300 hover:border-primary hover:text-primary"
            >
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile View All */}
        <Link
          href="/shop"
          className="mt-8 flex items-center justify-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] md:hidden"
        >
          View All Products
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </section>
  );
};

export default BestSellers;

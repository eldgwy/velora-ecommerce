"use client";

import Link from "next/link";
import { ArrowUpRight, Mail, ArrowRight } from "lucide-react";
import { FaInstagram, FaFacebookF, FaXTwitter } from "react-icons/fa6";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const Footer = () => {
  const footerRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const footer = footerRef.current;

      if (!footer) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const brand = footer.querySelector<HTMLElement>(".footer-brand");
      const columns = gsap.utils.toArray<HTMLElement>(".footer-column");
      const bottom = footer.querySelector<HTMLElement>(".footer-bottom");
      const mark = footer.querySelector<HTMLElement>(".footer-mark");
      const line = footer.querySelector<HTMLElement>(".footer-line");

      if (!brand || !bottom || !mark || !line) return;

      gsap.set(brand, {
        y: 35,
        opacity: 0,
      });

      gsap.set(columns, {
        y: 25,
        opacity: 0,
      });

      gsap.set(bottom, {
        y: 20,
        opacity: 0,
      });

      gsap.set(mark, {
        y: 50,
        opacity: 0,
      });

      gsap.set(line, {
        scaleX: 0,
        transformOrigin: "left center",
      });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: footer,
          start: "top 82%",
          toggleActions: "play none none reverse",
        },
      });

      timeline
        .to(
          brand,
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power3.out",
          },
          0,
        )
        .to(
          columns,
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            stagger: 0.08,
            ease: "power3.out",
          },
          0.12,
        )
        .to(
          line,
          {
            scaleX: 1,
            duration: 0.8,
            ease: "power3.out",
          },
          0.35,
        )
        .to(
          bottom,
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            ease: "power3.out",
          },
          0.45,
        )
        .to(
          mark,
          {
            y: 0,
            opacity: 1,
            duration: 1,
            ease: "power3.out",
          },
          0.2,
        );
    },
    {
      scope: footerRef,
    },
  );

  const shopLinks = [
    { label: "New Arrivals", href: "/collections/new-arrivals" },
    { label: "Best Sellers", href: "/collections/best-sellers" },
    { label: "Collections", href: "/collections" },
    { label: "Sale", href: "/collections/sale" },
  ];

  const companyLinks = [
    { label: "Our Story", href: "/about" },
    { label: "Journal", href: "/journal" },
    { label: "Careers", href: "/careers" },
    { label: "Contact", href: "/contact" },
  ];

  const supportLinks = [
    { label: "Shipping & Delivery", href: "/shipping" },
    { label: "Returns & Exchanges", href: "/returns" },
    { label: "FAQ", href: "/faq" },
    { label: "Size Guide", href: "/size-guide" },
  ];

  return (
    <footer
      ref={footerRef}
      className="relative overflow-hidden bg-primary text-white"
    >
      {/* Decorative Background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 size-96 rounded-full border border-white/4"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full border border-white/4"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-32 size-80 rounded-full border border-white/4"
      />

      <div className="relative mx-auto max-w-360 px-5 md:px-8 lg:px-12">
        {/* Main Footer */}
        <div className="grid gap-14 py-20 md:py-24 lg:grid-cols-[1.35fr_2fr] lg:gap-20 lg:py-28">
          {/* Brand */}
          <div className="footer-brand max-w-md">
            <Link
              href="/"
              className="group inline-flex items-center"
              aria-label="VELORA Home"
            >
              <span className="font-display text-3xl tracking-[0.12em] transition-opacity duration-300 group-hover:opacity-75 md:text-4xl">
                VELORA
              </span>
            </Link>

            <p className="mt-6 max-w-sm text-sm leading-7 text-white/50">
              Thoughtfully selected pieces for a life of quiet luxury. Discover
              timeless design, refined materials, and effortless elegance.
            </p>

            {/* Newsletter Mini */}
            <div className="mt-8 max-w-sm">
              <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.28em] text-accent">
                Stay Connected
              </p>

              <form className="group flex items-center border-b border-white/20 pb-2 transition-colors duration-300 focus-within:border-accent">
                <Mail className="mr-3 size-3.5 shrink-0 text-white/40" />

                <input
                  type="email"
                  placeholder="Your email address"
                  aria-label="Email address"
                  className="h-9 min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
                />

                <button
                  type="submit"
                  aria-label="Subscribe"
                  className="group/button flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-primary transition-all duration-300 hover:bg-white"
                >
                  <ArrowRight className="size-3.5 transition-transform duration-300 group-hover/button:translate-x-0.5" />
                </button>
              </form>
            </div>

            {/* Social */}
            <div className="mt-8 flex items-center gap-2">
              <Link
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="flex size-9 items-center justify-center rounded-full border border-white/10 text-white/50 transition-all duration-300 hover:border-accent/50 hover:bg-white/5 hover:text-accent"
              >
                <FaInstagram className="size-3.5" />
              </Link>

              <Link
                href="https://facebook.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                className="flex size-9 items-center justify-center rounded-full border border-white/10 text-white/50 transition-all duration-300 hover:border-accent/50 hover:bg-white/5 hover:text-accent"
              >
                <FaFacebookF className="size-3.5" />
              </Link>

              <Link
                href="https://twitter.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Twitter"
                className="flex size-9 items-center justify-center rounded-full border border-white/10 text-white/50 transition-all duration-300 hover:border-accent/50 hover:bg-white/5 hover:text-accent"
              >
                <FaXTwitter className="size-3.5" />
              </Link>
            </div>
          </div>

          {/* Navigation */}
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {/* Shop */}
            <div className="footer-column">
              <p className="mb-5 text-[9px] font-semibold uppercase tracking-[0.28em] text-accent">
                Shop
              </p>

              <ul className="space-y-3.5">
                {shopLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-1.5 text-xs text-white/50 transition-colors duration-300 hover:text-white"
                    >
                      {link.label}

                      <ArrowUpRight className="size-2.5 opacity-0 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-70" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div className="footer-column">
              <p className="mb-5 text-[9px] font-semibold uppercase tracking-[0.28em] text-accent">
                Company
              </p>

              <ul className="space-y-3.5">
                {companyLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-1.5 text-xs text-white/50 transition-colors duration-300 hover:text-white"
                    >
                      {link.label}

                      <ArrowUpRight className="size-2.5 opacity-0 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-70" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Support */}
            <div className="footer-column col-span-2 sm:col-span-1">
              <p className="mb-5 text-[9px] font-semibold uppercase tracking-[0.28em] text-accent">
                Support
              </p>

              <ul className="space-y-3.5">
                {supportLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-1.5 text-xs text-white/50 transition-colors duration-300 hover:text-white"
                    >
                      {link.label}

                      <ArrowUpRight className="size-2.5 opacity-0 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-70" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Large Brand Mark */}
        <div
          aria-hidden="true"
          className="footer-mark pointer-events-none -mb-5 select-none overflow-hidden text-center md:-mb-8"
        >
          <span className="font-display text-[7rem] font-light leading-none tracking-tighter text-white/[0.035] sm:text-[10rem] md:text-[14rem] lg:text-[18rem]">
            VELORA
          </span>
        </div>

        {/* Divider */}
        <div className="footer-line h-px bg-white/10" />

        {/* Bottom */}
        <div className="footer-bottom flex flex-col gap-5 py-6 md:flex-row md:items-center md:justify-between">
          <p className="text-[9px] uppercase tracking-[0.12em] text-white/30">
            © {new Date().getFullYear()} VELORA. All rights reserved.
          </p>

          <div className="flex flex-wrap items-center gap-5">
            <Link
              href="/privacy"
              className="text-[9px] uppercase tracking-[0.12em] text-white/30 transition-colors duration-300 hover:text-white/70"
            >
              Privacy
            </Link>

            <Link
              href="/terms"
              className="text-[9px] uppercase tracking-[0.12em] text-white/30 transition-colors duration-300 hover:text-white/70"
            >
              Terms
            </Link>

            <Link
              href="/cookies"
              className="text-[9px] uppercase tracking-[0.12em] text-white/30 transition-colors duration-300 hover:text-white/70"
            >
              Cookies
            </Link>
          </div>

          <p className="text-[9px] uppercase tracking-[0.12em] text-white/20">
            Crafted with intention
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

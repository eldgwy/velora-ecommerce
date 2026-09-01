"use client";

import { NAV_LINKS } from "@/constants";
import Link from "next/link";
import Search from "../Search";
import { Button } from "../ui/button";
import { ShoppingBag, UserRound, Menu, X, SearchIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

const Navbar = () => {
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const header = headerRef.current;
      const nav = navRef.current;

      if (!header || !nav) return;

      const updateNavbar = () => {
        const isScrolled = window.scrollY > 24;

        gsap.to(header, {
          y: isScrolled ? 12 : 0,
          duration: 0.45,
          ease: "power3.out",
          overwrite: true,
        });

        gsap.to(nav, {
          width: isScrolled ? "calc(100% - 32px)" : "100%",
          borderRadius: isScrolled ? 999 : 0,
          paddingTop: isScrolled ? 14 : 20,
          paddingBottom: isScrolled ? 14 : 20,
          duration: 0.45,
          ease: "power3.out",
          overwrite: true,
        });
      };

      updateNavbar();

      window.addEventListener("scroll", updateNavbar, {
        passive: true,
      });

      return () => {
        window.removeEventListener("scroll", updateNavbar);
      };
    },
    { scope: headerRef },
  );

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const isLinkActive = (url: string) => {
    if (url === "/") {
      return pathname === "/";
    }

    return pathname === url || pathname.startsWith(`${url}/`);
  };

  return (
    <>
      {/* ================================
          Desktop Navbar
          ================================ */}

      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-50 px-3 md:px-0"
      >
        <nav
          ref={navRef}
          className="
      mx-auto
      flex w-full
      items-center justify-between
      border border-transparent
      bg-transparent
      px-5 py-5
      transition-[background-color,border-color,box-shadow,backdrop-filter]
      duration-300
      md:px-8
    "
        >
          {/* Brand */}
          <Link
            href="/"
            className="
    relative
    shrink-0
    font-display
    text-xl
    tracking-[0.2em]
    text-foreground
    transition-opacity
    duration-300
    hover:opacity-60
    md:text-2xl
  "
          >
            VELORA
          </Link>

          {/* Navigation */}
          <div className="hidden md:flex md:items-center">
            <ul className="flex items-center gap-8">
              {NAV_LINKS.map((link) => {
                const active = isLinkActive(link.url);

                return (
                  <li key={link.title}>
                    <Link
                      href={link.url}
                      aria-current={active ? "page" : undefined}
                      className={`
              group
              relative
              inline-flex
              py-2
              text-[13px]
              font-medium
              tracking-[0.08em]
              transition-colors
              duration-300
              ${
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            `}
                    >
                      {link.title}

                      <span
                        className={`
                absolute
                bottom-0
                left-1/2
                h-px
                -translate-x-1/2
                bg-velora-gold
                transition-all
                duration-300
                ${active ? "w-full" : "w-0 group-hover:w-full"}
              `}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Actions */}
          <div className="hidden items-center gap-2 md:flex">
            {/* Search */}

            <Button
              variant="ghost"
              aria-label="Search"
              onClick={() => setIsSearchOpen((prev) => !prev)}
              className="
    group
    h-10 w-10
    overflow-hidden
    rounded-full
    border border-border/70
    bg-white/50
    p-0
    backdrop-blur-md
    transition-all
    duration-300
    hover:w-24
    hover:border-velora-gold/60
    hover:bg-white
  "
            >
              <div className="flex items-center gap-2">
                <SearchIcon className="size-4 shrink-0" />

                <span
                  className="
        max-w-0
        overflow-hidden
        whitespace-nowrap
        text-xs
        opacity-0
        transition-all
        duration-300
        group-hover:max-w-12
        group-hover:opacity-100
      "
                >
                  Search
                </span>
              </div>
            </Button>

            {/* Login */}

            <Link
              href="/login"
              aria-label="Login"
              className="
    group
    flex h-10 w-10
    items-center justify-center
    gap-2
    overflow-hidden
    rounded-full
    border border-border/70
    bg-white/50
    backdrop-blur-md
    transition-all
    duration-300
    hover:w-20
    hover:border-velora-gold/60
    hover:bg-white
  "
            >
              <UserRound className="size-4 shrink-0" />

              <span
                className="
      max-w-0
      overflow-hidden
      whitespace-nowrap
      text-xs
      opacity-0
      transition-all
      duration-300
      group-hover:max-w-10
      group-hover:opacity-100
    "
              >
                Login
              </span>
            </Link>

            {/* Cart */}

            <Link
              href="/cart"
              aria-label="Cart"
              className="
    group
    flex h-10 w-10
    items-center justify-center
    gap-2
    overflow-visible
    rounded-full
    bg-primary
    px-0
    text-primary-foreground
    shadow-sm
    transition-all
    duration-300
    hover:w-20
    hover:-translate-y-0.5
    hover:bg-velora-emerald-dark
  "
            >
              <span className="relative shrink-0">
                <ShoppingBag className="size-4" />

                <span
                  className="
        absolute
        -right-2
        -top-2
        flex size-4
        items-center justify-center
        rounded-full
        bg-velora-gold
        text-[9px]
        font-bold
        text-foreground
      "
                >
                  0
                </span>
              </span>

              <span
                className="
      max-w-0
      overflow-hidden
      whitespace-nowrap
      text-xs
      opacity-0
      transition-all
      duration-300
      group-hover:max-w-8
      group-hover:opacity-100
    "
              >
                Cart
              </span>
            </Link>
          </div>

          {/* Mobile Navbar */}
          <div className="flex items-center gap-2 md:hidden">
            {/* Search Mobile */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search"
              onClick={() => setIsSearchOpen((prev) => !prev)}
              className="
    size-10
    rounded-full
    border border-border/70
    bg-white/60
    backdrop-blur-md
  "
            >
              <SearchIcon className="size-4" />
            </Button>

            {/* Cart Mobile */}
            <Link
              href="/cart"
              aria-label="Cart"
              className="
    relative
    flex size-10
    items-center justify-center
    rounded-full
    bg-primary
    text-primary-foreground
  "
            >
              <ShoppingBag className="size-4" />

              <span
                className="
      absolute
      -right-0.5
      -top-0.5
      flex size-4
      items-center justify-center
      rounded-full
      bg-velora-gold
      text-[9px]
      font-bold
      text-foreground
    "
              >
                0
              </span>
            </Link>

            {/* Menu */}
            <Button
              variant="ghost"
              size="icon"
              aria-label={isOpen ? "Close menu" : "Open menu"}
              aria-expanded={isOpen}
              onClick={() => setIsOpen((prev) => !prev)}
              className="size-10 rounded-full border border-border/70 bg-white/60 backdrop-blur-md"
            >
              {isOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </nav>
        {isOpen ? (
          <div className="absolute left-3 right-3 top-[calc(100%+8px)] rounded-3xl border border-white/70 bg-white/90 p-6 shadow-[0_20px_60px_rgba(24,28,26,0.10)] backdrop-blur-2xl md:hidden">
            <div className="p-6">
              {/* Mobile Menu Links */}
              <ul className="flex flex-col">
                {NAV_LINKS.map((link, index) => {
                  const active = isLinkActive(link.url);

                  return (
                    <li
                      key={link.title}
                      className={`transition-all duration-500 ${isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
                      style={{
                        transitionDelay: isOpen ? `${index * 50}ms` : "0ms",
                      }}
                    >
                      <Link
                        href={link.url}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center justify-between border-b border-border-subtle py-5 font-display text-2xl transition-colors duration-300 ${active ? "text-velora-emerald" : "text-foreground hover:text-velora-emerald"}`}
                        onClick={() => setIsOpen(false)}
                      >
                        <span>{link.title}</span>

                        <span
                          className={`h-1.5 w-1.5 rounded-full bg-velora-gold transition-all duration-300 ${active ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* Mobile Account */}
              <div
                className={`
                mt-5
                transition-all duration-500
                ${
                  isOpen
                    ? "translate-y-0 opacity-100"
                    : "translate-y-4 opacity-0"
                }
              `}
                style={{
                  transitionDelay: isOpen
                    ? `${NAV_LINKS.length * 50 + 100}ms`
                    : "0ms",
                }}
              >
                <Link
                  href="/login"
                  className="
                  flex items-center justify-center
                  gap-2
                  rounded-full
                  border border-border
                  bg-white/60
                  px-5 py-3
                  text-sm font-medium
                  backdrop-blur-md
                  transition-colors duration-300
                  hover:border-velora-gold
                "
                  onClick={() => setIsOpen(false)}
                >
                  <UserRound className="size-4" />
                  Login
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      {/* ================================
          Search Overlay
          ================================ */}

      {isSearchOpen && <Search setIsSearchOpen={setIsSearchOpen} />}
    </>
  );
};

export default Navbar;

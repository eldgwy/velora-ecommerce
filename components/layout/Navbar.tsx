"use client";

import { NAV_LINKS } from "@/constants/Links";
import Link from "next/link";
import Search from "../Search";
import { Button } from "../ui/button";
import { ShoppingBag, UserRound, Menu, X, SearchIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const Navbar = () => {
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

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
        className={`
          z-50 hidden w-full md:block
          transition-all duration-500 ease-out
          ${
            scrolled
              ? "fixed left-1/2 top-4 w-[calc(100%-2rem)] max-w-7xl -translate-x-1/2"
              : "relative"
          }
        `}
      >
        <nav
          className={`
            flex items-center justify-between
            px-8 py-5
            transition-all duration-500
            ${
              scrolled
                ? `
                  velora-glass-strong
                  rounded-full
                  border border-white/60
                  shadow-[0_12px_40px_rgba(24,28,26,0.08)]
                `
                : ""
            }
          `}
        >
          {/* Brand */}

          <Link
            href="/"
            className="
              font-display
              text-2xl
              tracking-[0.18em]
              text-foreground
              transition-opacity duration-300
              hover:opacity-70
            "
          >
            VELORA
          </Link>

          {/* Navigation */}

          <ul className="flex items-center gap-8">
            {NAV_LINKS.map((link) => {
              const active = isLinkActive(link.url);

              return (
                <li key={link.title}>
                  <Link
                    href={link.url}
                    aria-current={active ? "page" : undefined}
                    className={`
                      group relative
                      py-2
                      text-sm
                      font-medium
                      tracking-wide
                      transition-colors duration-300
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
                        -bottom-0.5
                        left-1/2
                        h-px
                        -translate-x-1/2
                        bg-velora-gold
                        transition-all duration-300
                        ${active ? "w-full" : "w-0 group-hover:w-full"}
                      `}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Actions */}

          <div className="flex items-center gap-3">
            {/* Search */}

            <Button
              variant="ghost"
              aria-label="Search"
              onClick={() => setIsSearchOpen((prev) => !prev)}
              className="
                group
                flex h-10 w-10
                items-center justify-center
                gap-2
                overflow-hidden
                rounded-full
                border border-border
                bg-white/60
                px-0
                text-foreground
                backdrop-blur-md
                transition-all duration-300 ease-out
                hover:w-28
                hover:border-velora-gold
                hover:bg-white
              "
            >
              <SearchIcon className="size-4 shrink-0 transition-transform duration-300 group-hover:scale-95" />

              <span
                className="
                  max-w-0
                  overflow-hidden
                  whitespace-nowrap
                  text-sm
                  opacity-0
                  transition-all duration-300
                  group-hover:max-w-16
                  group-hover:opacity-100
                "
              >
                Search
              </span>
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
                border border-border
                bg-white/60
                px-0
                text-foreground
                backdrop-blur-md
                transition-all duration-300 ease-out
                hover:w-24
                hover:border-velora-gold
                hover:bg-white
              "
            >
              <UserRound className="size-4 shrink-0" />

              <span
                className="
                  max-w-0
                  overflow-hidden
                  whitespace-nowrap
                  text-sm
                  opacity-0
                  transition-all duration-300
                  group-hover:max-w-12
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
                text-sm
                font-medium
                text-primary-foreground
                shadow-sm
                transition-all duration-300 ease-out
                hover:w-24
                hover:-translate-y-0.5
                hover:bg-velora-emerald-dark
              "
            >
              <span className="relative shrink-0">
                <ShoppingBag className="size-4" />

                <span
                  className="
                    absolute -right-2 -top-2
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
                  text-sm
                  opacity-0
                  transition-all duration-300
                  group-hover:max-w-10
                  group-hover:opacity-100
                "
              >
                Cart
              </span>
            </Link>
          </div>
        </nav>
      </header>

      {/* ================================
          Mobile Navbar
          ================================ */}

      <header className="relative z-50 md:hidden">
        <nav
          className={`
            flex items-center justify-between
            px-5 py-5
            transition-all duration-300
            ${
              scrolled
                ? `
                  fixed left-1/2 top-3
                  w-[calc(100%-1.5rem)]
                  -translate-x-1/2
                  velora-glass-strong
                  rounded-full
                  border border-white/60
                `
                : ""
            }
          `}
        >
          {/* Brand */}
          <Link
            href="/"
            className="
              font-display
              text-xl
              tracking-[0.16em]
              text-foreground
            "
          >
            VELORA
          </Link>

          {/* Mobile Actions */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <Button
              variant="ghost"
              aria-label="Search"
              onClick={() => setIsSearchOpen((prev) => !prev)}
              className="
                group
                flex h-10 w-10
                items-center justify-center
                gap-2
                overflow-hidden
                rounded-full
                border border-border
                bg-white/60
                px-0
                text-foreground
                backdrop-blur-md
                transition-all duration-300 ease-out
                hover:border-velora-gold
                hover:bg-white
              "
            >
              <SearchIcon className="size-4 shrink-0 transition-transform duration-300 group-hover:scale-95" />
            </Button>

            {/* Cart */}
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
                  absolute -right-0.5 -top-0.5
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
              className="
                size-10
                rounded-full
                border border-border
                bg-white/60
                backdrop-blur-md
              "
            >
              {isOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </nav>

        {/* Mobile Menu */}
        <div
          className={`
            fixed inset-x-3 top-20 z-40
            overflow-hidden
            rounded-3xl
            border border-white/70
            bg-white/85
            shadow-[0_20px_60px_rgba(24,28,26,0.12)]
            backdrop-blur-2xl
            transition-all duration-500 ease-out
            ${
              isOpen
                ? "max-h-[80vh] translate-y-0 opacity-100"
                : "pointer-events-none max-h-0 -translate-y-3 opacity-0"
            }
          `}
        >
          <div className="p-6">
            {/* Mobile Menu Links */}
            <ul className="flex flex-col">
              {NAV_LINKS.map((link, index) => {
                const active = isLinkActive(link.url);

                return (
                  <li
                    key={link.title}
                    className={`
                      transition-all duration-500
                      ${
                        isOpen
                          ? "translate-y-0 opacity-100"
                          : "translate-y-4 opacity-0"
                      }
                    `}
                    style={{
                      transitionDelay: isOpen ? `${index * 50}ms` : "0ms",
                    }}
                  >
                    <Link
                      href={link.url}
                      aria-current={active ? "page" : undefined}
                      className={`
                        flex items-center justify-between
                        border-b border-border-subtle
                        py-5
                        font-display
                        text-2xl
                        transition-colors duration-300
                        ${
                          active
                            ? "text-velora-emerald"
                            : "text-foreground hover:text-velora-emerald"
                        }
                      `}
                      onClick={() => setIsOpen(false)}
                    >
                      <span>{link.title}</span>

                      <span
                        className={`
                          h-1.5 w-1.5
                          rounded-full
                          bg-velora-gold
                          transition-all duration-300
                          ${
                            active
                              ? "scale-100 opacity-100"
                              : "scale-0 opacity-0"
                          }
                        `}
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
      </header>

      {/* ================================
          Search Overlay
          ================================ */}

      {isSearchOpen && <Search setIsSearchOpen={setIsSearchOpen} />}
    </>
  );
};

export default Navbar;

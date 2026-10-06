"use client";

import { NAV_LINKS } from "@/shared/constants";
import Link from "next/link";
import Search from "../Search";
import { Button } from "../ui/button";
import {
  ShoppingBag,
  UserRound,
  Menu,
  X,
  SearchIcon,
  Settings,
  LogOut,
  User,
  MailWarning,
  ShieldCheck,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { authClient } from "@/shared/lib/auth-client";
import { ADMIN_ROLES, type UserRole } from "@/shared/lib/roles";
import { Spinner } from "@/shared/components/ui/spinner";
import { toast } from "sonner";
import Image from "next/image";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Returns up to 2 uppercase initials from a display name. */
function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// ─── User Avatar ─────────────────────────────────────────────────────────────

interface UserAvatarProps {
  image?: string | null;
  name: string;
  className?: string;
}

function UserAvatar({ image, name, className = "" }: UserAvatarProps) {
  return (
    <span
      className={`relative flex size-9 shrink-0 select-none items-center justify-center overflow-hidden rounded-full border-2 border-velora-gold/60 bg-velora-emerald/10 text-sm font-semibold text-velora-emerald ring-2 ring-white/80 transition-transform duration-200 hover:scale-105 ${className}`}
    >
      {image ? (
        <Image
          src={image}
          alt={name}
          fill
          sizes="36px"
          className="object-cover"
        />
      ) : (
        getInitials(name)
      )}
    </span>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const { data: session, isPending } = authClient.useSession();
  const user = session?.user ?? null;
  const isEmailVerified = user?.emailVerified ?? true;
  // FR-01.06: staff roles see a direct route into the admin surface.
  const isStaff = !!user?.role && ADMIN_ROLES.includes(user.role as UserRole);

  const [isResendingVerification, setIsResendingVerification] = useState(false);

  /** Sign out and redirect to home. */
  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  };

  /** Re-send the verification link for the signed-in but unverified user. */
  const handleResendVerification = async () => {
    if (!user?.email) return;

    setIsResendingVerification(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: user.email,
      });

      if (error) {
        toast.error(
          error.message || "Couldn't send the verification email. Try again.",
        );
        return;
      }

      toast.success(`Verification email sent to ${user.email}.`);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't send the verification email. Try again.",
      );
    } finally {
      setIsResendingVerification(false);
    }
  };

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
      window.addEventListener("scroll", updateNavbar, { passive: true });
      return () => window.removeEventListener("scroll", updateNavbar);
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
    if (url === "/") return pathname === "/";
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
          className="mx-auto flex w-full items-center justify-between border border-transparent bg-transparent px-5 py-5 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 md:px-8"
        >
          {/* Brand */}
          <Link
            href="/"
            className="relative shrink-0 font-display text-xl tracking-[0.2em] text-foreground transition-opacity duration-300 hover:opacity-60 md:text-2xl"
          >
            VELORA
          </Link>

          {/* Navigation links */}
          <div className="hidden md:flex md:items-center">
            <ul className="flex items-center gap-8">
              {NAV_LINKS.map((link) => {
                const active = isLinkActive(link.url);
                return (
                  <li key={link.title}>
                    <Link
                      href={link.url}
                      aria-current={active ? "page" : undefined}
                      className={`group relative inline-flex py-2 text-[13px] font-medium tracking-[0.08em] transition-colors duration-300 ${
                        active
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {link.title}
                      <span
                        className={`absolute bottom-0 left-1/2 h-px -translate-x-1/2 bg-velora-gold transition-all duration-300 ${
                          active ? "w-full" : "w-0 group-hover:w-full"
                        }`}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Actions – desktop */}
          <div className="hidden items-center gap-2 md:flex">
            {/* Search */}
            <Button
              variant="ghost"
              aria-label="Search"
              onClick={() => setIsSearchOpen((prev) => !prev)}
              className="group h-10 w-10 overflow-hidden rounded-full border border-border/70 bg-white/50 p-0 backdrop-blur-md transition-all duration-300 hover:w-24 hover:border-velora-gold/60 hover:bg-white"
            >
              <div className="flex items-center gap-2">
                <SearchIcon className="size-4 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all duration-300 group-hover:max-w-12 group-hover:opacity-100">
                  Search
                </span>
              </div>
            </Button>

            {/* User / Login */}
            {isPending ? (
              /* Skeleton while session resolves */
              <span className="size-10 animate-pulse rounded-full border border-border/70 bg-white/50 backdrop-blur-md" />
            ) : user ? (
              /* ── Authenticated: avatar + dropdown ── */
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      aria-label="Open user menu"
                      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-velora-gold focus-visible:ring-offset-2"
                    />
                  }
                >
                  <UserAvatar image={user.image} name={user.name} />
                </DropdownMenuTrigger>

                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="w-56 rounded-2xl border border-border/60 bg-white/90 p-1.5 shadow-[0_16px_48px_rgba(24,28,26,0.12)] backdrop-blur-xl"
                >
                  {/* User info header */}
                  <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2">
                    <UserAvatar
                      image={user.image}
                      name={user.name}
                      className="size-8 text-xs"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {user.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </p>
                      {!isEmailVerified && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700">
                          <MailWarning className="size-3" />
                          Unverified
                        </span>
                      )}
                    </div>
                  </DropdownMenuLabel>

                  <DropdownMenuSeparator className="my-1 bg-border/50" />

                  {!isEmailVerified && (
                    <DropdownMenuItem
                      onClick={handleResendVerification}
                      disabled={isResendingVerification}
                      className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 focus:bg-amber-50 focus:text-amber-700"
                    >
                      {isResendingVerification ? (
                        <Spinner className="size-4 shrink-0" />
                      ) : (
                        <MailWarning className="size-4 shrink-0" />
                      )}
                      {isResendingVerification
                        ? "Sending link..."
                        : "Verify email"}
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem
                    render={
                      <Link
                        href="/account/profile"
                        className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-foreground transition-colors hover:bg-velora-emerald/8 hover:text-velora-emerald"
                      />
                    }
                  >
                    <User className="size-4 shrink-0 text-muted-foreground" />
                    Profile
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    render={
                      <Link
                        href="/account/settings"
                        className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-foreground transition-colors hover:bg-velora-emerald/8 hover:text-velora-emerald"
                      />
                    }
                  >
                    <Settings className="size-4 shrink-0 text-muted-foreground" />
                    Settings
                  </DropdownMenuItem>

                  {isStaff && (
                    <DropdownMenuItem
                      render={
                        <Link
                          href="/admin"
                          className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-foreground transition-colors hover:bg-velora-emerald/8 hover:text-velora-emerald"
                        />
                      }
                    >
                      <ShieldCheck className="size-4 shrink-0 text-velora-emerald" />
                      Admin dashboard
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator className="my-1 bg-border/50" />

                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 focus:bg-red-50 focus:text-red-600"
                  >
                    <LogOut className="size-4 shrink-0" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              /* ── Guest: Login link ── */
              <Link
                href="/login"
                aria-label="Login"
                className="group flex h-10 w-10 items-center justify-center gap-2 overflow-hidden rounded-full border border-border/70 bg-white/50 backdrop-blur-md transition-all duration-300 hover:w-20 hover:border-velora-gold/60 hover:bg-white"
              >
                <UserRound className="size-4 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all duration-300 group-hover:max-w-10 group-hover:opacity-100">
                  Login
                </span>
              </Link>
            )}

            {/* Cart */}
            <Link
              href="/cart"
              aria-label="Cart"
              className="group flex h-10 w-10 items-center justify-center gap-2 overflow-visible rounded-full bg-primary px-0 text-primary-foreground shadow-sm transition-all duration-300 hover:w-20 hover:-translate-y-0.5 hover:bg-velora-emerald-dark"
            >
              <span className="relative shrink-0">
                <ShoppingBag className="size-4" />
                <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-velora-gold text-[9px] font-bold text-foreground">
                  0
                </span>
              </span>
              <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all duration-300 group-hover:max-w-8 group-hover:opacity-100">
                Cart
              </span>
            </Link>
          </div>

          {/* Actions – mobile */}
          <div className="flex items-center gap-2 md:hidden">
            {/* Search Mobile */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search"
              onClick={() => setIsSearchOpen((prev) => !prev)}
              className="size-10 rounded-full border border-border/70 bg-white/60 backdrop-blur-md"
            >
              <SearchIcon className="size-4" />
            </Button>

            {/* Cart Mobile */}
            <Link
              href="/cart"
              aria-label="Cart"
              className="relative flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <ShoppingBag className="size-4" />
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-velora-gold text-[9px] font-bold text-foreground">
                0
              </span>
            </Link>

            {/* Menu toggle */}
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

        {/* Mobile drawer */}
        {isOpen && (
          <div className="absolute left-3 right-3 top-[calc(100%+8px)] rounded-3xl border border-white/70 bg-white/90 p-6 shadow-[0_20px_60px_rgba(24,28,26,0.10)] backdrop-blur-2xl md:hidden">
            <div className="p-6">
              {/* Links */}
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
                        className={`flex items-center justify-between border-b border-border-subtle py-5 font-display text-2xl transition-colors duration-300 ${
                          active
                            ? "text-velora-emerald"
                            : "text-foreground hover:text-velora-emerald"
                        }`}
                        onClick={() => setIsOpen(false)}
                      >
                        <span>{link.title}</span>
                        <span
                          className={`h-1.5 w-1.5 rounded-full bg-velora-gold transition-all duration-300 ${
                            active
                              ? "scale-100 opacity-100"
                              : "scale-0 opacity-0"
                          }`}
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* Account section */}
              <div
                className={`mt-5 transition-all duration-500 ${isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
                style={{
                  transitionDelay: isOpen
                    ? `${NAV_LINKS.length * 50 + 100}ms`
                    : "0ms",
                }}
              >
                {user ? (
                  <div className="flex flex-col gap-2">
                    {/* User info card */}
                    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-white/60 px-4 py-3 backdrop-blur-md">
                      <UserAvatar
                        image={user.image}
                        name={user.name}
                        className="size-10 text-sm"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {user.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </p>
                        {!isEmailVerified && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700">
                            <MailWarning className="size-3" />
                            Unverified
                          </span>
                        )}
                      </div>
                    </div>

                    {!isEmailVerified && (
                      <button
                        type="button"
                        onClick={handleResendVerification}
                        disabled={isResendingVerification}
                        className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-left text-sm font-medium text-amber-700 backdrop-blur-md transition-colors hover:bg-amber-100 disabled:pointer-events-none disabled:opacity-60"
                      >
                        {isResendingVerification ? (
                          <Spinner className="size-4 shrink-0" />
                        ) : (
                          <MailWarning className="size-4 shrink-0" />
                        )}
                        {isResendingVerification
                          ? "Sending verification link..."
                          : "Verify your email address"}
                      </button>
                    )}

                    <Link
                      href="/account/profile"
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-white/60 px-4 py-3 text-sm font-medium backdrop-blur-md transition-colors hover:border-velora-gold"
                    >
                      <User className="size-4 text-muted-foreground" />
                      Profile
                    </Link>

                    <Link
                      href="/account/settings"
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-white/60 px-4 py-3 text-sm font-medium backdrop-blur-md transition-colors hover:border-velora-gold"
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings
                    </Link>

                    {isStaff && (
                      <Link
                        href="/admin"
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-2.5 rounded-2xl border border-velora-emerald/30 bg-velora-emerald/5 px-4 py-3 text-sm font-medium text-velora-emerald backdrop-blur-md transition-colors hover:border-velora-gold"
                      >
                        <ShieldCheck className="size-4" />
                        Admin dashboard
                      </Link>
                    )}

                    <button
                      onClick={() => {
                        setIsOpen(false);
                        handleSignOut();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm font-medium text-red-600 backdrop-blur-md transition-colors hover:bg-red-100"
                    >
                      <LogOut className="size-4" />
                      Logout
                    </button>
                  </div>
                ) : (
                  <Link
                    href="/login"
                    className="flex items-center justify-center gap-2 rounded-full border border-border bg-white/60 px-5 py-3 text-sm font-medium backdrop-blur-md transition-colors duration-300 hover:border-velora-gold"
                    onClick={() => setIsOpen(false)}
                  >
                    <UserRound className="size-4" />
                    Login
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ================================
          Search Overlay
          ================================ */}

      {isSearchOpen && <Search setIsSearchOpen={setIsSearchOpen} />}
    </>
  );
};

export default Navbar;

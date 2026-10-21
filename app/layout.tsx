import type { Metadata } from "next";
import { DM_Serif_Display, Manrope } from "next/font/google";
import dynamic from "next/dynamic";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/providers/ThemeProvider";
import { Toaster } from "@/shared/components/ui/sonner";
import { env } from "@/config/env";

// Lazily loaded: inertial scrolling must not sit in the first-paint bundle
// (T-4.3/GP-36). Renders null; all work is in its effect.
const SmoothScroll = dynamic(
  () => import("@/shared/components/providers/SmoothScroll"),
);

const displayFont = DM_Serif_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const sansFont = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // GP-29: single canonical origin for all absolute URLs Next generates
  // (Open Graph images, alternates, sitemap cross-references).
  metadataBase: new URL(env.BETTER_AUTH_URL),
  title: {
    default: "VELORA — Modern Commerce",
    template: "%s — VELORA",
  },
  description:
    "A curated modern commerce experience designed for contemporary living.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme is applied to <html> pre-paint by
    // the blocking script below, so the class intentionally differs from the
    // server render and must not be patched during hydration.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${displayFont.variable} ${sansFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Blocking theme snippet: plain <script> in <body> (not next/script
            under <html>) so React hydration sees valid HTML and it runs
            pre-paint to avoid a theme flash. */}
        <script
          id="velora-theme"
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;function s(t){d.classList.remove("light","dark");d.classList.add(t);d.style.colorScheme=t}try{var t=localStorage.getItem("theme")||"system";if(t==="system"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}s(t)}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          <SmoothScroll />
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

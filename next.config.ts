import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  // Prevent clickjacking
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  // Prevent MIME type sniffing
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // Enable XSS protection (legacy but still useful)
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  // Referrer policy
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // Permissions policy (restrict browser features)
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // HSTS - only in production
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
  // Content Security Policy
  // origins locked to the actual integration flows:
  //   Stripe Payment Element (modules/checkout/.../stripe-payment-form.tsx):
  //     script + frame share https://js.stripe.com (loadStripe injects the
  //     SDK itself; the Element renders inside a js.stripe.com iframe);
  //     api.stripe.com serves REST calls, m.stripe.network the fraud SDK.
  //   Cloudinary direct upload (review/banner/collection upload components):
  //     browser PUTs go to https://api.cloudinary.com; display images are
  //     covered by img-src https.
  // 'unsafe-eval' is dev-only: Next.js dev tooling (react-refresh) needs it;
  // production never does.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://js.stripe.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://api.stripe.com https://m.stripe.network https://api.cloudinary.com",
      "frame-src https://js.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  /* Route `forbidden()` calls render app/forbidden.tsx with HTTP 403. */
  experimental: {
    authInterrupts: true,
    // Turbopack's persistent filesystem cache (default-on since v16.1) is
    // counterproductive on this workstation: 1.8 GB of cache DB on a
    // mechanical HDD (HGST 7200 rpm, 467 ms fs benchmark) with ~2 GB
    // available RAM — each "filesystem cache database compaction" ran
    // 36-102 s (observed up to 27 min of next.js-side request time), far
    // exceeding the cost of recompiling in-memory. Deleting the cache DB
    // and skipping compaction is the documented opt-out
    // (docs/config/next-config-js/turbopackFileSystemCache.md).
    turbopackFileSystemCacheForDev: false,
    // The build cache is equally dead weight here: local `next build` has
    // never succeeded on this box (OOM) and CI never restores .next/cache
    // (only the pnpm store is cached in .github/workflows/ci.yml), so
    // nothing ever reads the 762 MB the build cache would write.
    turbopackFileSystemCacheForBuild: false,
  },
  // Product/brand/review media is served from Cloudinary (signed uploads).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  // Security headers
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

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

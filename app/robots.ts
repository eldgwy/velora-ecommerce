import type { MetadataRoute } from "next";

import { env } from "@/config/env";

/**
 * Crawler policy (GP-29): the storefront is public; the admin console,
 * API routes, and customer-account/checkout surfaces are not.
 *
 * The base URL comes from BETTER_AUTH_URL — the deployment's canonical
 * origin, already required and validated by the env schema. No separate
 * SEO-URL variable is introduced to avoid a second origin source of truth.
 */
export default function robots(): MetadataRoute.Robots {
  const base = new URL(env.BETTER_AUTH_URL);

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/api",
          "/api/",
          "/account",
          "/account/",
          "/cart",
          "/checkout",
        ],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base.host,
  };
}
